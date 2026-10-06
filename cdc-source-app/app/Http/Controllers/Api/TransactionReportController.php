<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\FactTransactionReport;
use Illuminate\Http\Request;

class TransactionReportController extends Controller
{
    /**
     * ENDPOINT 1: CARA LAMA (Baca dari Source DB dengan Eloquent JOIN/Eager Loading)
     * Ini akan memicu banyak query ke database.
     */
    public function oldWay(Request $request)
    {
        $start = microtime(true); // Mulai timer

        // Query berat: Eloquent akan melakukan 1 query ke orders, 
        // lalu query terpisah untuk customers, details, journals, dan journal_details.
        $data = Order::query()
            ->with(['customer', 'details', 'journal.details'])
            ->when($request->search, function($q, $search) {
                $q->where('order_number', 'like', "%$search%");
            })
            ->orderBy('created_at', 'desc')
            ->paginate(50); // Kita ambil 50 data agar perbedaan waktu terasa

        $end = microtime(true); // Stop timer

        return response()->json([
            'method' => 'OLD WAY (Source DB - Eloquent Eager Loading)',
            'execution_time_ms' => round(($end - $start) * 1000, 2), // Dalam milidetik
            'total_queries' => \DB::getQueryLog() ? count(\DB::getQueryLog()) : 'N/A (Enable query log to see)',
            'data' => $data
        ]);
    }

    /**
     * ENDPOINT 2: CARA BARU (Baca dari Reporting DB - Tabel Flat)
     * Hanya 1 Query super cepat.
     */
    public function newWay(Request $request)
    {
        $start = microtime(true); // Mulai timer

        // Query super ringan: Hanya membaca 1 tabel yang sudah di-flatten
        $data = FactTransactionReport::query()
            ->when($request->search, function($q, $search) {
                $q->where('order_number', 'like', "%$search%");
            })
            ->orderBy('order_date', 'desc')
            ->paginate(50);

        $end = microtime(true); // Stop timer

        return response()->json([
            'method' => 'NEW WAY (Reporting DB - Flat Table via CDC)',
            'execution_time_ms' => round(($end - $start) * 1000, 2), // Dalam milidetik
            'total_queries' => 1, // Karena cuma 1 tabel, pasti cuma 1 query
            'data' => $data
        ]);
    }

    /**
     * ENDPOINT 3: CLICKHOUSE WAY (Baca dari ClickHouse via HTTP API)
     * Sangat cepat untuk agregasi jutaan baris.
     */
    public function clickhouseWay(Request $request)
    {
        $start = microtime(true); // Mulai timer

        // ClickHouse HTTP API
        $query = "SELECT * FROM reporting_db.fact_transaction_report";
        if ($request->search) {
            $query .= " WHERE order_number LIKE '%" . addslashes($request->search) . "%'";
        }
        $query .= " ORDER BY order_date DESC LIMIT 50 FORMAT JSON";

        // Eksekusi query ke ClickHouse menggunakan Http Client Laravel bawaan
        $response = \Illuminate\Support\Facades\Http::withBasicAuth('admin', 'Password_ch2026')
            ->withBody($query, 'text/plain')
            ->post('http://clickhouse-server:8123');

        $end = microtime(true); // Stop timer

        return response()->json([
            'method' => 'CLICKHOUSE WAY (Ultra Fast Analytical DB)',
            'execution_time_ms' => round(($end - $start) * 1000, 2),
            'total_queries' => 1,
            'data' => $response->json()['data'] ?? []
        ]);
    }

    // ==========================================
    // SIMULASI EKSTRIM (ANALYTICS / AGREGASI)
    // ==========================================

    public function analyticsOld(Request $request)
    {
        $start = microtime(true);
        $data = \Illuminate\Support\Facades\DB::table('orders')
            ->selectRaw("TO_CHAR(created_at, 'YYYY-MM') as month, status, SUM(total_amount) as total_sales")
            ->groupByRaw("TO_CHAR(created_at, 'YYYY-MM'), status")
            ->orderBy('month', 'desc')
            ->get();
        $end = microtime(true);

        return response()->json([
            'method' => 'OLD WAY ANALYTICS (Source DB)',
            'execution_time_ms' => round(($end - $start) * 1000, 2),
            'data' => $data
        ]);
    }

    public function analyticsNew(Request $request)
    {
        $start = microtime(true);
        $data = FactTransactionReport::query()
            ->selectRaw("TO_CHAR(order_date, 'YYYY-MM') as month, status, SUM(total_amount) as total_sales")
            ->groupByRaw("TO_CHAR(order_date, 'YYYY-MM'), status")
            ->orderBy('month', 'desc')
            ->get();
        $end = microtime(true);

        return response()->json([
            'method' => 'NEW WAY ANALYTICS (Reporting DB)',
            'execution_time_ms' => round(($end - $start) * 1000, 2),
            'data' => $data
        ]);
    }

    public function analyticsClickhouse(Request $request)
    {
        $start = microtime(true);
        
        // ClickHouse menggunakan fungsi toYYYYMM untuk format bulanan (lebih cepat dari parsing string)
        $query = "
            SELECT 
                toYYYYMM(order_date) as month, 
                status, 
                SUM(total_amount) as total_sales 
            FROM reporting_db.fact_transaction_report 
            GROUP BY month, status 
            ORDER BY month DESC 
            FORMAT JSON
        ";

        $response = \Illuminate\Support\Facades\Http::withBasicAuth('admin', 'Password_ch2026')
            ->withBody($query, 'text/plain')
            ->post('http://clickhouse-server:8123');
            
        $end = microtime(true);

        return response()->json([
            'method' => 'CLICKHOUSE ANALYTICS (Ultra Fast)',
            'execution_time_ms' => round(($end - $start) * 1000, 2),
            'data' => $response->json()['data'] ?? []
        ]);
    }
}