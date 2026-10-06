<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\TransactionReportController;

// Endpoint Cara Lama (Source DB)
Route::get('/transactions/report/old', [TransactionReportController::class, 'oldWay']);

// Endpoint Cara Baru (Reporting DB via CDC)
Route::get('/transactions/report/new', [TransactionReportController::class, 'newWay']);

// Endpoint ClickHouse (Membaca dari ClickHouse via CDC)
Route::get('/transactions/report/clickhouse', [TransactionReportController::class, 'clickhouseWay']);