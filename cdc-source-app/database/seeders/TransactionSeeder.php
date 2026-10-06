<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\{Customer, Order, OrderDetail, Journal, JournalDetail};
use Illuminate\Support\Str;

class TransactionSeeder extends Seeder
{
    public function run(): void
    {
        $faker = \Faker\Factory::create('id_ID');

        $totalRecords = 50000;
        $chunkSize = 1000;

        for ($i = 0; $i < $totalRecords; $i += $chunkSize) {
            $customers = [];
            $orders = [];
            $orderDetails = [];
            $journals = [];
            $journalDetails = [];

            $now = now();

            for ($j = 0; $j < $chunkSize; $j++) {
                $idx = $i + $j;
                $customerId = $idx + 1; // ID statis agar cepat
                $orderId = $idx + 1;
                $journalId = $idx + 1;
                $totalAmount = $faker->randomElement([2500000, 5000000, 7500000, 10000000]);
                $orderNumber = 'INV-' . strtoupper(Str::random(6)) . '-' . str_pad($idx, 6, '0', STR_PAD_LEFT);
                $transactionDate = clone $now;
                $transactionDate->subDays(rand(0, 365)); // Acak dalam 1 tahun terakhir

                $customers[] = [
                    'id' => $customerId,
                    'name' => 'Company ' . $idx,
                    'email' => 'company' . $idx . '@example.com',
                    'phone' => '021-' . rand(1000000, 9999999),
                    'created_at' => $now,
                    'updated_at' => $now
                ];

                $orders[] = [
                    'id' => $orderId,
                    'customer_id' => $customerId,
                    'order_number' => $orderNumber,
                    'total_amount' => $totalAmount,
                    'status' => $faker->randomElement(['pending', 'completed', 'cancelled']),
                    'created_at' => $transactionDate,
                    'updated_at' => $transactionDate
                ];

                $orderDetails[] = ['order_id' => $orderId, 'product_name' => 'Laptop Asus', 'qty' => 1, 'price' => 2000000, 'subtotal' => 2000000, 'created_at' => $now, 'updated_at' => $now];
                $orderDetails[] = ['order_id' => $orderId, 'product_name' => 'Mouse Wireless', 'qty' => 2, 'price' => 250000, 'subtotal' => 500000, 'created_at' => $now, 'updated_at' => $now];

                $journals[] = [
                    'id' => $journalId,
                    'order_id' => $orderId,
                    'journal_number' => 'JU-' . $orderNumber,
                    'transaction_date' => $transactionDate,
                    'description' => 'Pencatatan ' . $orderNumber,
                    'created_at' => $transactionDate,
                    'updated_at' => $transactionDate
                ];

                $journalDetails[] = ['journal_id' => $journalId, 'account_code' => '1-1101', 'account_name' => 'Kas / Bank', 'debit' => $totalAmount, 'credit' => 0, 'created_at' => $now, 'updated_at' => $now];
                $journalDetails[] = ['journal_id' => $journalId, 'account_code' => '4-1101', 'account_name' => 'Pendapatan', 'debit' => 0, 'credit' => $totalAmount, 'created_at' => $now, 'updated_at' => $now];
            }

            // Insert per chunk (sangat cepat)
            \Illuminate\Support\Facades\DB::table('customers')->insert($customers);
            \Illuminate\Support\Facades\DB::table('orders')->insert($orders);
            \Illuminate\Support\Facades\DB::table('order_details')->insert($orderDetails);
            \Illuminate\Support\Facades\DB::table('journals')->insert($journals);
            \Illuminate\Support\Facades\DB::table('journal_details')->insert($journalDetails);
            
            echo "Seeded " . ($i + $chunkSize) . " records...\n";
        }

    }
}