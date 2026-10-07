// src/index.ts
import postgres from 'postgres';
import { createClient } from '@clickhouse/client';
import { MongoClient } from 'mongodb';

// 1. Koneksi ke Database Source (Laravel) dan Reporting
const sourceDb = postgres({
    host: process.env.SOURCE_DB_HOST,
    port: Number(process.env.SOURCE_DB_PORT),
    database: process.env.SOURCE_DB_NAME,
    username: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASS,
    max: 10,
});

const targetConfig = process.env.TARGET_DB || 'postgres'; // postgres, clickhouse, mongodb, both, all

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

const mongoUrl = `mongodb://${process.env.MONGO_DB_USER || 'root'}:${process.env.MONGO_DB_PASS || 'rootpassword'}@${process.env.MONGO_DB_HOST || 'mongodb'}:${process.env.MONGO_DB_PORT || 27017}`;
const mongoClient = new MongoClient(mongoUrl);
let mongoDb: any;
mongoClient.connect().then(() => {
    mongoDb = mongoClient.db(process.env.MONGO_DB_NAME || 'testing_db');
    console.log("[Worker] Connected to MongoDB");
});

const BATCH_SIZE = 2500; // Ditingkatkan karena kita menggunakan metode Bulk Processing
const SLEEP_MS = 500;

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

        const t0 = performance.now();
        console.log(`\n[Worker] Menemukan ${queue.length} perubahan mentah di antrean.`);

        const affectedOrderIds = new Set<number>();

        // Dalam bulk operations, kita mungkin perlu mecari order mana saja yang terdampak
        for (const row of queue) {
            if (row.table_name === 'customers') {
                // Untuk customer, kita tidak query di sini karena akan menyebabkan N+1 lagi.
                // Lebih baik kumpulkan semua customer_id, lalu query sekaligus
            }
        }
        
        // Optimasi: kumpulkan customer_id
        const affectedCustomerIds = new Set<number>();
        for (const row of queue) {
            if (row.table_name === 'customers') {
                affectedCustomerIds.add(row.record_id);
            } else {
                affectedOrderIds.add(row.record_id);
            }
        }
        
        if (affectedCustomerIds.size > 0) {
            const customerIdsArray = Array.from(affectedCustomerIds);
            const orders = await sql`SELECT id FROM orders WHERE customer_id IN ${sql(customerIdsArray)}`;
            orders.forEach(o => affectedOrderIds.add(o.id));
        }

        const orderIdsArray = Array.from(affectedOrderIds);
        console.log(`[Worker] Total Order ID unik yang akan di-sync: ${orderIdsArray.length}`);

        if (orderIdsArray.length > 0) {
            await syncBulk(orderIdsArray, sql);
        }

        const processedIds = queue.map(q => q.id);
        await sql`UPDATE cdc_queue SET processed = true WHERE id IN ${sql(processedIds)}`;

        const t1 = performance.now();
        console.log(`[Worker] ✅ Selesai memproses ${orderIdsArray.length} orders ke target '${targetConfig}' dalam ${((t1 - t0) / 1000).toFixed(2)} detik`);
    });
}

async function syncBulk(orderIdsArray: number[], sourceSql: any) {
    // 1. Ambil data orders yang masih ada (aktif) dari Source Database
    const ordersData = await sourceSql`
        SELECT 
            o.id as order_id, o.order_number, o.created_at as order_date, 
            o.total_amount, o.status, o.updated_at as source_updated_at,
            c.id as customer_id, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
            j.journal_number, j.transaction_date as journal_date, j.description as journal_description
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
        LEFT JOIN journals j ON o.id = j.order_id
        WHERE o.id IN ${sourceSql(orderIdsArray)}
    `;

    const existingOrderIds = new Set(ordersData.map((o: any) => Number(o.order_id)));
    const deletedOrderIds = orderIdsArray.filter(id => !existingOrderIds.has(id));

    let itemsMap = new Map();
    let entriesMap = new Map();

    // Hanya ambil relasi data (items/journals) untuk order yang eksis
    if (existingOrderIds.size > 0) {
        const items = await sourceSql`
            SELECT order_id, json_agg(json_build_object(
                'id', id, 'product_name', product_name, 'qty', qty, 'price', price, 'subtotal', subtotal
            )) as data
            FROM order_details 
            WHERE order_id IN ${sourceSql(Array.from(existingOrderIds))}
            GROUP BY order_id
        `;
        items.forEach((row: any) => itemsMap.set(row.order_id, row.data));

        const entries = await sourceSql`
            SELECT j.order_id, json_agg(json_build_object(
                'id', jd.id, 'account_code', jd.account_code, 'account_name', jd.account_name, 'debit', jd.debit, 'credit', jd.credit
            )) as data
            FROM journal_details jd
            JOIN journals j ON jd.journal_id = j.id
            WHERE j.order_id IN ${sourceSql(Array.from(existingOrderIds))}
            GROUP BY j.order_id
        `;
        entries.forEach((row: any) => entriesMap.set(row.order_id, row.data));
    }

    const formatDt = (d: any) => d ? new Date(d).toISOString().replace('T', ' ').substring(0, 19) : null;
    const formatDate = (d: any) => d ? new Date(d).toISOString().split('T')[0] : null;

    // 2. Siapkan array dokumen ter-denormalisasi untuk Database SQL (Postgres, ClickHouse)
    const sqlDocs = ordersData.map((o: any) => ({
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
        order_items: JSON.stringify(itemsMap.get(o.order_id) || []),
        journal_entries: JSON.stringify(entriesMap.get(o.order_id) || []),
        source_created_at: formatDt(o.order_date),
        source_updated_at: formatDt(o.source_updated_at),
        synced_at: formatDt(new Date())
    }));

    // 3. Siapkan array dokumen ter-denormalisasi untuk NoSQL (MongoDB - format asli objek JSON)
    const mongoDocs = ordersData.map((o: any) => ({
        order_id: Number(o.order_id),
        order_number: o.order_number,
        order_date: o.order_date,
        total_amount: Number(o.total_amount),
        status: o.status,
        customer_id: Number(o.customer_id),
        customer_name: o.customer_name,
        customer_email: o.customer_email,
        customer_phone: o.customer_phone,
        journal_number: o.journal_number,
        journal_date: o.journal_date,
        journal_description: o.journal_description,
        order_items: itemsMap.get(o.order_id) || [],
        journal_entries: entriesMap.get(o.order_id) || [],
        source_created_at: o.order_date,
        source_updated_at: o.source_updated_at,
        synced_at: new Date()
    }));

    const promises = [];

    // === TARGET: POSTGRES (REPORTING DB) ===
    if (targetConfig === 'postgres' || targetConfig === 'both' || targetConfig === 'all') {
        promises.push((async () => {
            if (deletedOrderIds.length > 0) {
                await reportDb`DELETE FROM fact_transaction_report WHERE order_id IN ${reportDb(deletedOrderIds)}`;
            }
            if (sqlDocs.length > 0) {
                await reportDb`
                    INSERT INTO fact_transaction_report ${reportDb(sqlDocs)}
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
                        synced_at = EXCLUDED.synced_at
                `;
            }
        })());
    }

    // === TARGET: CLICKHOUSE ===
    if (targetConfig === 'clickhouse' || targetConfig === 'both' || targetConfig === 'all') {
        promises.push((async () => {
            if (deletedOrderIds.length > 0) {
                const ids = deletedOrderIds.join(',');
                await clickhouse.command({
                    query: `ALTER TABLE fact_transaction_report DELETE WHERE order_id IN (${ids})`
                });
            }
            if (sqlDocs.length > 0) {
                await clickhouse.insert({
                    table: 'fact_transaction_report',
                    values: sqlDocs,
                    format: 'JSONEachRow'
                });
            }
        })());
    }

    // === TARGET: MONGODB ===
    if (targetConfig === 'mongodb' || targetConfig === 'all') {
        promises.push((async () => {
            if (!mongoDb) return;
            if (deletedOrderIds.length > 0) {
                await mongoDb.collection('fact_transaction_report').deleteMany({ order_id: { $in: deletedOrderIds } });
            }
            if (mongoDocs.length > 0) {
                const bulkOps = mongoDocs.map((doc: any) => ({
                    updateOne: {
                        filter: { order_id: doc.order_id },
                        update: { $set: doc },
                        upsert: true
                    }
                }));
                await mongoDb.collection('fact_transaction_report').bulkWrite(bulkOps);
            }
        })());
    }

    // Jalankan sinkronisasi secara paralel
    await Promise.all(promises);
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