#!/bin/bash

echo -e "\n🚀 MEMULAI BENCHMARK BACA DATA (LIMIT 50)...\n"

# Endpoint URL
endpoints=(
    "1. Postgres (Cara Lama)|http://localhost:8009/api/transactions/report/old"
    "2. Postgres (Tabel Flat)|http://localhost:8009/api/transactions/report/new"
    "3. MongoDB (Document DB)|http://localhost:8009/api/transactions/report/mongo"
    "4. ClickHouse (Analytic)|http://localhost:8009/api/transactions/report/clickhouse"
)

# Loop melalui setiap endpoint
for item in "${endpoints[@]}"; do
    name="${item%%|*}"
    url="${item##*|}"
    
    # Menarik data menggunakan curl dan mengambil execution_time_ms menggunakan jq
    # Pastikan jq sudah terinstall di sistem (sudo apt install jq)
    time_ms=$(curl -s "$url" | grep -oP '"execution_time_ms":\s*\K[0-9.]+')
    
    # Jika grep gagal mencari, berikan nilai N/A
    if [ -z "$time_ms" ]; then
        time_ms="N/A"
    fi
    
    # Print hasil format rapi
    printf "%-30s : \033[1;32m%s ms\033[0m\n" "$name" "$time_ms"
done

echo -e "\n✅ Selesai!\n"
