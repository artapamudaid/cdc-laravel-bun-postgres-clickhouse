-- Database: reporting_db

CREATE TABLE IF NOT EXISTS fact_transaction_report (
    -- PRIMARY KEY (Dari tabel Orders)
    order_id            BIGINT PRIMARY KEY,
    order_number        VARCHAR(50) NOT NULL,
    order_date          TIMESTAMP NOT NULL,
    total_amount        NUMERIC(15, 2) NOT NULL,
    status              VARCHAR(20) NOT NULL,
    
    -- DATA CUSTOMER (Flat dari tabel Customers)
    customer_id         BIGINT NOT NULL,
    customer_name       VARCHAR(100) NOT NULL,
    customer_email      VARCHAR(100),
    customer_phone      VARCHAR(20),
    
    -- DATA JURNAL HEADER (Flat dari tabel Journals)
    journal_number      VARCHAR(50),
    journal_date        DATE,
    journal_description TEXT,
    
    -- DATA DETAIL (Disimpan sebagai JSONB agar tetap 1 baris per order)
    order_items         JSONB DEFAULT '[]'::jsonb, 
    journal_entries     JSONB DEFAULT '[]'::jsonb, 
    
    -- METADATA CDC
    source_created_at   TIMESTAMP,      
    source_updated_at   TIMESTAMP,      
    synced_at           TIMESTAMP DEFAULT NOW()
);

-- ==========================================
-- INDEXING
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_fact_trx_customer ON fact_transaction_report(customer_id);
CREATE INDEX IF NOT EXISTS idx_fact_trx_status ON fact_transaction_report(status);
CREATE INDEX IF NOT EXISTS idx_fact_trx_date ON fact_transaction_report(order_date);
CREATE INDEX IF NOT EXISTS idx_fact_trx_number ON fact_transaction_report(order_number);
CREATE INDEX IF NOT EXISTS idx_fact_trx_items_gin ON fact_transaction_report USING GIN (order_items);
