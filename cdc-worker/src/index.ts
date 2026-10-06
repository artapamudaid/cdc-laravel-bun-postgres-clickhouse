// src/index.ts
import postgres from 'postgres';
import { createClient } from '@clickhouse/client';

// 1. Koneksi ke Database Source (Laravel) dan Reporting
const sourceDb = postgres({
    host: process.env.SOURCE_DB_HOST,
    port: Number(process.env.SOURCE_DB_PORT),
    database: process.env.SOURCE_DB_NAME,
    username: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASS,
    max: 10,
});

const targetConfig = process.env.TARGET_DB || 'postgres'; // postgres, clickhouse, both

const reportDb = postgres({
    host: process.env.REPORT_DB_HOST,
    port: Number(process.env.REPORT_DB_PORT),
    database: process.env.REPORT_DB_NAME,
    username: process.env.REPORT_DB_USER,
    password: process.env.REPORT_DB_PASS,
    max: 10,
});

const clickhouse = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE,
});

const BATCH_SIZE = 500;
const SLEEP_MS = 1000;

// 2. Fungsi Utama: Memproses Antrean
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
            return;
        }

        console.log(`\n[Worker] Menemukan ${queue.length} perubahan mentah di antrean.`);

        const affectedOrderIds = new Set<number>();

        for (const row of queue) {
            if (row.table_name === 'customers') {
                const orders = await sql`SELECT id FROM orders WHERE customer_id = ${row.record_id}`;
                orders.forEach(o => affectedOrderIds.add(o.id));
            } else {
                affectedOrderIds.add(row.record_id);
            }
        }

        console.log(`[Worker] Total Order ID unik yang akan di-sync: ${affectedOrderIds.size}`);

        for (const orderId of affectedOrderIds) {
            if (targetConfig === 'postgres' || targetConfig === 'both') {
                await syncOrderToReport(orderId, sql);
            }
            if (targetConfig === 'clickhouse' || targetConfig === 'both') {
                await syncOrderToClickHouse(orderId, sql);
            }
        }

        const processedIds = queue.map(q => q.id);
        await sql`UPDATE cdc_queue SET processed = true WHERE id = ANY(${processedIds})`;

        console.log(`[Worker] ✅ Selesai sync ${affectedOrderIds.size} orders ke target: ${targetConfig}`);
    });
}

// 3. Fungsi Sync ke Postgres (Reporting DB)
async function syncOrderToReport(orderId: number, sourceSql: any) {
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

    if (orderData.length === 0) {
        await reportDb`DELETE FROM fact_transaction_report WHERE order_id = ${orderId}`;
        return;
    }

    const o = orderData[0];

    const items = await sourceSql`
        SELECT json_agg(json_build_object(
            'id', id, 'product_name', product_name, 'qty', qty, 'price', price, 'subtotal', subtotal
        )) as data
        FROM order_details WHERE order_id = ${orderId}
    `;

    const entries = await sourceSql`
        SELECT json_agg(json_build_object(
            'id', jd.id, 'account_code', jd.account_code, 'account_name', jd.account_name, 'debit', jd.debit, 'credit', jd.credit
        )) as data
        FROM journal_details jd
        JOIN journals j ON jd.journal_id = j.id
        WHERE j.order_id = ${orderId}
    `;

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
            ${items[0]?.data || '[]'}, ${entries[0]?.data || '[]'}, ${o.order_date}, ${o.source_updated_at}, NOW()
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

// 4. Fungsi Sync ke ClickHouse
async function syncOrderToClickHouse(orderId: number, sourceSql: any) {
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

    if (orderData.length === 0) {
        // Untuk ReplacingMergeTree, implementasi penghapusan biasanya butuh mutasi khusus atau penanda is_deleted.
        // Sebagai alternatif sederhana, kita biarkan saja (atau hapus manual bila butuh).
        return;
    }

    const o = orderData[0];

    const items = await sourceSql`
        SELECT json_agg(json_build_object(
            'id', id, 'product_name', product_name, 'qty', qty, 'price', price, 'subtotal', subtotal
        )) as data
        FROM order_details WHERE order_id = ${orderId}
    `;

    const entries = await sourceSql`
        SELECT json_agg(json_build_object(
            'id', jd.id, 'account_code', jd.account_code, 'account_name', jd.account_name, 'debit', jd.debit, 'credit', jd.credit
        )) as data
        FROM journal_details jd
        JOIN journals j ON jd.journal_id = j.id
        WHERE j.order_id = ${orderId}
    `;

    const formatDt = (d: any) => d ? new Date(d).toISOString().replace('T', ' ').substring(0, 19) : null;
    const formatDate = (d: any) => d ? new Date(d).toISOString().split('T')[0] : null;

    const row = {
        order_id: Number(o.order_id),
        order_number: String(o.order_number),
        order_date: formatDt(o.order_date),
        total_amount: Number(o.total_amount),
        status: String(o.status),
        customer_id: Number(o.customer_id),
        customer_name: String(o.customer_name),
        customer_email: o.customer_email ? String(o.customer_email) : null,
        customer_phone: o.customer_phone ? String(o.customer_phone) : null,
        journal_number: o.journal_number ? String(o.journal_number) : null,
        journal_date: formatDate(o.journal_date),
        journal_description: o.journal_description ? String(o.journal_description) : null,
        order_items: items[0]?.data ? JSON.stringify(items[0].data) : '[]',
        journal_entries: entries[0]?.data ? JSON.stringify(entries[0].data) : '[]',
        source_created_at: formatDt(o.order_date),
        source_updated_at: formatDt(o.source_updated_at),
        synced_at: formatDt(new Date())
    };

    await clickhouse.insert({
        table: 'fact_transaction_report',
        values: [row],
        format: 'JSONEachRow'
    });
}

// 5. Health Check Server
Bun.serve({
    port: process.env.APP_PORT,
    fetch() {
        return new Response("CDC Worker is alive 🚀", { status: 200 });
    },
});
console.log(`[Health] Server berjalan di port ${process.env.APP_PORT}`);

// 6. Main Loop
async function main() {
    console.log(`[Worker] CDC Worker started. Target: ${targetConfig}. Polling every ${SLEEP_MS}ms...`);
    while (true) {
        try {
            await processBatch();
        } catch (error) {
            console.error("[Worker] Error:", error);
        }
        await Bun.sleep(SLEEP_MS);
    }
}

// Handle Graceful Shutdown
process.on('SIGINT', async () => {
    console.log("\n[Worker] Shutting down gracefully...");
    await sourceDb.end();
    await reportDb.end();
    await clickhouse.close();
    process.exit(0);
});

main();