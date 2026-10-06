<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FactTransactionReport extends Model
{
    // 1. Paksa pakai koneksi database reporting
    protected $connection = 'pgsql_reporting';
    
    // 2. Nama tabel flat
    protected $table = 'fact_transaction_report';
    
    // 3. Primary key bukan 'id' biasa, tapi 'order_id'
    protected $primaryKey = 'order_id';
    
    // 4. Kita tidak pakai created_at/updated_at bawaan Laravel di tabel ini
    public $timestamps = false;

    // 5. Cast kolom JSONB otomatis menjadi Array/Object PHP
    protected $casts = [
        'order_date' => 'datetime',
        'journal_date' => 'date',
        'order_items' => 'array',       // JSONB -> Array
        'journal_entries' => 'array',   // JSONB -> Array
        'synced_at' => 'datetime',
        'total_amount' => 'decimal:2',
    ];
}