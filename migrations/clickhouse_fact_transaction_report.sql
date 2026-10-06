-- Database: default (ClickHouse)

CREATE TABLE IF NOT EXISTS fact_transaction_report
(
    -- PRIMARY KEY (Dari tabel Orders)
    order_id            Int64,
    order_number        String,
    order_date          DateTime,
    total_amount        Decimal(15, 2),
    status              String,
    
    -- DATA CUSTOMER (Flat dari tabel Customers)
    customer_id         Int64,
    customer_name       String,
    customer_email      Nullable(String),
    customer_phone      Nullable(String),
    
    -- DATA JURNAL HEADER (Flat dari tabel Journals)
    journal_number      Nullable(String),
    journal_date        Nullable(Date),
    journal_description Nullable(String),
    
    -- DATA DETAIL (Disimpan sebagai String JSON karena tipe data JSON masih experimental di CH)
    order_items         String DEFAULT '[]', 
    journal_entries     String DEFAULT '[]', 
    
    -- METADATA CDC
    source_created_at   Nullable(DateTime),
    source_updated_at   Nullable(DateTime),
    synced_at           DateTime DEFAULT now()
)
-- Menggunakan ReplacingMergeTree agar jika ada order_id yang sama masuk (update CDC), Clickhouse akan menyimpan versi terbarunya berdasarkan synced_at.
ENGINE = ReplacingMergeTree(synced_at)
ORDER BY (order_id)
SETTINGS index_granularity = 8192;

-- ==========================================
-- INDEXING di Clickhouse (Data Skipping Indices)
-- ==========================================
ALTER TABLE fact_transaction_report ADD INDEX IF NOT EXISTS idx_fact_trx_customer customer_id TYPE minmax GRANULARITY 4;
ALTER TABLE fact_transaction_report ADD INDEX IF NOT EXISTS idx_fact_trx_status status TYPE set(0) GRANULARITY 4;
ALTER TABLE fact_transaction_report ADD INDEX IF NOT EXISTS idx_fact_trx_date order_date TYPE minmax GRANULARITY 4;
ALTER TABLE fact_transaction_report ADD INDEX IF NOT EXISTS idx_fact_trx_number order_number TYPE bloom_filter() GRANULARITY 4;
