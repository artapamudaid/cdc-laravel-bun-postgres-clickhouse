// src/index.ts
import postgres from 'postgres';

// 1. Koneksi ke Database Source (Laravel) dan Reporting
const sourceDb = postgres({
    host: process.env.SOURCE_DB_HOST,
    port: Number(process.env.SOURCE_DB_PORT),
    database: process.env.SOURCE_DB_NAME,
    username: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASS,
    max: 10, // Maksimal 10 koneksi pool
});

const reportDb = postgres({
    host: process.env.REPORT_DB_HOST,
    port: Number(process.env.REPORT_DB_PORT),
    database: process.env.REPORT_DB_NAME,
    username: process.env.REPORT_DB_USER,
    password: process.env.REPORT_DB_PASS,
    max: 10,
});

const BATCH_SIZE = 500;
const SLEEP_MS = 1000; // Polling setiap 1 detik

// 2. Fungsi Utama: Memproses Antrean
// src/index.ts (Hanya ganti fungsi processBatch)

async function processBatch() {
    await sourceDb.begin(async (sql) => {
        const queue = await sql`
            SELECT id, table_name, record_id, action 
            FROM cdc_queue 
            WHERE processed = false 
            ORDER BY id ASC 
            LIMIT ${BATCH_SIZE}
            FOR UPDATE SKIP LOCKED
        `;

        if (queue.length === 0) {
            // console.log("[Worker] Antrean kosong, tidur lagi...");
            return;
        }

        console.log(`[Worker] Menemukan ${queue.length} perubahan mentah di antrean.`);

        const affectedOrderIds = new Set<number>();

        for (const row of queue) {
            console.log(`  -> Memproses: ${row.action} pada tabel ${row.table_name} (record_id: ${row.record_id})`);

            if (row.table_name === 'customers') {
                const orders = await sql`SELECT id FROM orders WHERE customer_id = ${row.record_id}`;
                if (orders.length === 0) {
                    console.log(`     (Customer ${row.record_id} belum punya order, skip)`);
                }
                orders.forEach(o => affectedOrderIds.add(o.id));
            } else {
                // Untuk orders, order_details, journals, journal_details
                affectedOrderIds.add(row.record_id);
            }
        }

        console.log(`[Worker] Total Order ID unik yang akan di-sync:`, Array.from(affectedOrderIds));

        for (const orderId of affectedOrderIds) {
            await syncOrderToReport(orderId, sql);
        }

        const processedIds = queue.map(q => q.id);
        await sql`UPDATE cdc_queue SET processed = true WHERE id = ANY(${processedIds})`;

        console.log(`[Worker] ✅ Selesai sync ${affectedOrderIds.size} orders.\n`);
    });
}

// 6. Fungsi Sync: JOIN data & Upsert ke Tabel Flat
async function syncOrderToReport(orderId: number, sourceSql: any) {
    // A. Ambil data utama (Orders + Customers + Journals Header)
    const orderData = await sourceSql`
        SELECT 
            o.id as order_id, o.order_number, o.created_at as order_date, 
            o.total_amount, o.status, o.updated_at as source_updated_at,
            c.id as customer_id, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
            j.journal_number, j.transaction_date as journal_date, j.description as journal_description
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
        LEFT JOIN journals j ON o.id = j.order_id
        WHERE o.id = ${orderId}
    `;

    // Jika order tidak ditemukan, berarti sudah di-DELETE di source
    if (orderData.length === 0) {
        await reportDb`DELETE FROM fact_transaction_report WHERE order_id = ${orderId}`;
        return;
    }

    const o = orderData[0];

    // B. Ambil Order Details sebagai JSON Array
    const items = await sourceSql`
        SELECT json_agg(json_build_object(
            'id', id, 'product_name', product_name, 'qty', qty, 'price', price, 'subtotal', subtotal
        )) as data
        FROM order_details WHERE order_id = ${orderId}
    `;

    // C. Ambil Journal Details sebagai JSON Array
    // ✅ KODE BARU (Fixed)
    const entries = await sourceSql`
        SELECT json_agg(json_build_object(
            'id', jd.id, 
            'account_code', jd.account_code, 
            'account_name', jd.account_name, 
            'debit', jd.debit, 
            'credit', jd.credit
        )) as data
        FROM journal_details jd
        JOIN journals j ON jd.journal_id = j.id
        WHERE j.order_id = ${orderId}
    `;

    // D. Upsert (Insert atau Update) ke Tabel Flat di Reporting DB
    await reportDb`
        INSERT INTO fact_transaction_report (
            order_id, order_number, order_date, total_amount, status,
            customer_id, customer_name, customer_email, customer_phone,
            journal_number, journal_date, journal_description,
            order_items, journal_entries, source_created_at, source_updated_at, synced_at
        ) VALUES (
            ${o.order_id}, ${o.order_number}, ${o.order_date}, ${o.total_amount}, ${o.status},
            ${o.customer_id}, ${o.customer_name}, ${o.customer_email}, ${o.customer_phone},
            ${o.journal_number}, ${o.journal_date}, ${o.journal_description},
            ${items[0]?.data || []}, ${entries[0]?.data || []}, ${o.order_date}, ${o.source_updated_at}, NOW()
        )
        ON CONFLICT (order_id) DO UPDATE SET
            order_number = EXCLUDED.order_number,
            order_date = EXCLUDED.order_date,
            total_amount = EXCLUDED.total_amount,
            status = EXCLUDED.status,
            customer_id = EXCLUDED.customer_id,
            customer_name = EXCLUDED.customer_name,
            customer_email = EXCLUDED.customer_email,
            customer_phone = EXCLUDED.customer_phone,
            journal_number = EXCLUDED.journal_number,
            journal_date = EXCLUDED.journal_date,
            journal_description = EXCLUDED.journal_description,
            order_items = EXCLUDED.order_items,
            journal_entries = EXCLUDED.journal_entries,
            source_updated_at = EXCLUDED.source_updated_at,
            synced_at = NOW()
    `;
}

// 7. Health Check Server (Agar Docker/Systemd tahu worker ini hidup)
Bun.serve({
    port: process.env.APP_PORT,
    fetch() {
        return new Response("CDC Worker is alive 🚀", { status: 200 });
    },
});
console.log(`[Health] Server berjalan di port ${process.env.APP_PORT}`);

// 8. Main Loop (Daemon)
async function main() {
    console.log(`[Worker] CDC Worker started. Polling every ${SLEEP_MS}ms...`);

    while (true) {
        try {
            await processBatch();
        } catch (error) {
            console.error("[Worker] Error:", error);
        }

        // Tidur sejenak (Non-blocking di Bun)
        await Bun.sleep(SLEEP_MS);
    }
}

// Handle Graceful Shutdown jika di-kill (Ctrl+C)
process.on('SIGINT', async () => {
    console.log("\n[Worker] Shutting down gracefully...");
    await sourceDb.end();
    await reportDb.end();
    process.exit(0);
});

// Jalankan!
main();