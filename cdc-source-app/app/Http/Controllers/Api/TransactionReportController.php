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
}