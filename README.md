# CDC Proof of Concept: Laravel 11 + Bun Worker + PostgreSQL + ClickHouse

Proyek ini adalah *Proof of Concept* (PoC) untuk mengimplementasikan arsitektur **Change Data Capture (CDC)** secara *real-time* dari *Source Database* (PostgreSQL) menuju dua *Reporting Database* sekaligus: **PostgreSQL (Tabel Flat)** dan **ClickHouse (Analytical DB)**.

## 🏛️ Arsitektur Sistem

Sistem ini disimulasikan menggunakan arsitektur jaringan *multi-server* di dalam Docker:

1. **Source App (Laravel 11)**: Berjalan di FrankenPHP (PHP 8.4). Berfungsi sebagai aplikasi utama yang menangani transaksi. Menyimpan data di **Postgres 1** dalam bentuk relasional yang normal (tabel `orders`, `customers`, `order_details`, dsb).
2. **CDC Trigger & Queue (Postgres 1)**: Menggunakan fitur *Trigger* bawaan Postgres untuk menangkap setiap operasi `INSERT`, `UPDATE`, `DELETE` secara otomatis dan menyimpannya ke dalam tabel `cdc_queue` tanpa membebani logika *code* aplikasi.
3. **CDC Worker (Bun / TypeScript)**: Layanan *daemon* super cepat yang berjalan terpisah. Worker ini bertugas melakukan *polling* (membaca) `cdc_queue` setiap 1 detik. Jika ada perubahan, worker akan mem- *flatten* (menggabungkan) relasi data transaksi menjadi JSON/Flat lalu mengirimkannya ke *Target Database*.
4. **Target DB 1 (Postgres 2)**: Database operasional terpisah khusus untuk *Reporting*. Data disimpan dalam 1 tabel *flat* (`fact_transaction_report`) agar *read query* sangat ringan (tidak ada operasi `JOIN` lagi).
5. **Target DB 2 (ClickHouse)**: Database analitik kelas kakap (OLAP) dengan format *column-oriented*. Data dikirim dalam format JSON langsung dari *worker*, menggunakan engine `ReplacingMergeTree` untuk menangani *upsert/sync*.

---

## 🚀 Cara Menjalankan

### 1. Build & Jalankan Docker Container
Pastikan Anda sudah menginstal Docker.
```bash
docker compose up -d --build
```
*Note: Ini akan menyalakan Laravel, Bun Worker, 2 Container Postgres, dan 1 Container ClickHouse.*

### 2. Setup Database (Migrasi & Dummy Data)
Jalankan migrasi Laravel untuk membuat tabel di Postgres 1 beserta *Trigger* CDC-nya, lalu masukkan 50.000 data *dummy* awal:
```bash
docker exec -it cdc-source-app-new php artisan migrate:fresh --seed --seeder=TransactionSeeder
```
*Tunggu sekitar belasan detik. 50.000 data akan tercatat, dan CDC Worker secara otomatis akan mem-push data tersebut ke Postgres 2 dan ClickHouse.*

---

## 🔗 Endpoint API (Simulasi & Komparasi)

Aplikasi Laravel telah diekspos ke Host pada port `8009`. Terdapat beberapa endpoint yang dibuat khusus untuk membandingkan perbedaan performa membaca data relasional (Cara Lama) VS membaca tabel *Flat* (Cara Baru) VS *Analytic Query* (ClickHouse).

### A. Membaca Data Mentah (Limit 50 baris)
- **Cara Lama (Eager Loading di Source DB)**: 
  `http://localhost:8009/api/transactions/report/old`
- **Cara Baru (Tabel Flat di Reporting DB Postgres)**: 
  `http://localhost:8009/api/transactions/report/new`
- **Cara Baru (ClickHouse DB)**: 
  `http://localhost:8009/api/transactions/report/clickhouse`

### B. Simulasi Ekstrim Analytics (Group By, Sum)
Beban sesungguhnya (*Analytics*) akan menguji kemampuan *engine* database saat menghitung total transaksi per bulan berdasarkan status pada 50.000++ baris data.
- **Analytics Cara Lama (Source DB)**: 
  `http://localhost:8009/api/transactions/analytics/old`
- **Analytics Cara Baru (Reporting DB Postgres)**: 
  `http://localhost:8009/api/transactions/analytics/new`
- **Analytics ClickHouse (Ultra Fast OLAP)**: 
  `http://localhost:8009/api/transactions/analytics/clickhouse`

---

## 🛠️ Konfigurasi CDC Worker

Jika Anda ingin mengubah target *database* Worker, edit *file* `.env` yang berada di dalam *folder* `cdc-worker`:
```env
# postgres, clickhouse, or both
TARGET_DB=both
```
Lalu *restart* kontainer Worker:
```bash
docker compose restart cdc-worker
```

## 🗄️ Akses Database Manual (Via Adminer / DBeaver)

- **Postgres 1 (Source)**: `localhost:54320` | user: `postgres` | pass: `postgres` | db: `aop_db`
- **Postgres 2 (Reporting)**: `localhost:54321` | user: `postgres` | pass: `postgres` | db: `reporting_db`
- **ClickHouse (Analytics)**: `localhost:8125` (HTTP) / `localhost:9010` (Native) | user: `admin` | pass: `Password_ch2026`

---

## 🧪 Simulasi Testing Langkah-demi-Langkah

Untuk melihat arsitektur CDC ini beraksi secara *real-time*, ikuti langkah-langkah *testing* berikut:

### Step 1: Buka Log CDC Worker
Buka terminal baru dan pantau log dari Bun Worker. Biarkan terminal ini tetap terbuka di sisi layar Anda:
```bash
docker logs -f cdc-laravel-bun-postgres-clickhouse-cdc-worker-1
```
*Di awal, Anda akan melihat pesan bahwa Worker sedang tertidur dan melakukan polling (mencari antrean baru).*

### Step 2: Buat Data Transaksi Baru
Di terminal lain, masuk ke dalam kontainer Laravel melalui Tinker:
```bash
docker exec -it cdc-source-app-new php artisan tinker
```
Lalu, paste perintah ini untuk men-*generate* 1 buah transaksi mentah ke Postgres 1:
```php
$customer = App\Models\Customer::create(['name' => 'Testing CDC', 'email' => 'cdc@test.com', 'phone' => '12345']);
$order = App\Models\Order::create(['customer_id' => $customer->id, 'order_number' => 'INV-TEST-001', 'total_amount' => 500000, 'status' => 'pending']);
App\Models\OrderDetail::create(['order_id' => $order->id, 'product_name' => 'Tes Produk', 'qty' => 1, 'price' => 500000, 'subtotal' => 500000]);
```

### Step 3: Pantau Keajaibannya!
1. Perhatikan terminal **Log Worker** Anda. Dalam waktu kurang dari 1 detik, Worker akan otomatis "terbangun" dan memproses data yang baru saja Anda buat!
2. Worker akan langsung melakukan JOIN (menggabungkan Order, Customer, dan Details) dan mengirimkannya ke Postgres 2 & ClickHouse.

### Step 4: Cek Hasil (Target DB)
Sekarang, hitung dan cek datanya melalui URL API (ganti *keyword* pencarian sesuai nama pesanan tadi `INV-TEST-001`):

- **[Cek di Postgres 2]** 
  `http://localhost:8009/api/transactions/report/new?search=INV-TEST-001`
- **[Cek di ClickHouse]** 
  `http://localhost:8009/api/transactions/report/clickhouse?search=INV-TEST-001`

Keduanya pasti sudah menampilkan data pesanan `INV-TEST-001` secara instan! 🚀
