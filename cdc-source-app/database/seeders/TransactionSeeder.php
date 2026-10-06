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

        for ($i = 0; $i < 1000; $i++) {
            // 1. Buat Customer
            $customer = Customer::create([
                'name' => $faker->company,
                'email' => $faker->unique()->companyEmail,
                'phone' => $faker->phoneNumber
            ]);

            // 2. Buat Order
            $totalAmount = $faker->randomElement([2500000, 5000000, 7500000, 10000000]);
            $order = Order::create([
                'customer_id' => $customer->id,
                'order_number' => 'INV-' . strtoupper(Str::random(6)) . '-' . str_pad($i, 4, '0', STR_PAD_LEFT),
                'total_amount' => $totalAmount,
                'status' => $faker->randomElement(['pending', 'completed', 'cancelled'])
            ]);

            // 3. Buat Order Details
            OrderDetail::create(['order_id' => $order->id, 'product_name' => 'Laptop Asus', 'qty' => 1, 'price' => 2000000, 'subtotal' => 2000000]);
            OrderDetail::create(['order_id' => $order->id, 'product_name' => 'Mouse Wireless', 'qty' => 2, 'price' => 250000, 'subtotal' => 500000]);

            // 4. Buat Jurnal (Akuntansi)
            $journal = Journal::create([
                'order_id' => $order->id,
                'journal_number' => 'JU-' . strtoupper(Str::random(6)) . '-' . str_pad($i, 4, '0', STR_PAD_LEFT),
                'transaction_date' => $faker->dateTimeBetween('-1 month', 'now'),
                'description' => 'Pencatatan penjualan ' . $order->order_number
            ]);

            // 5. Buat Jurnal Details (Debit = Credit)
            JournalDetail::create(['journal_id' => $journal->id, 'account_code' => '1-1101', 'account_name' => 'Kas / Bank', 'debit' => $totalAmount, 'credit' => 0]);
            JournalDetail::create(['journal_id' => $journal->id, 'account_code' => '4-1101', 'account_name' => 'Pendapatan Penjualan', 'debit' => 0, 'credit' => $totalAmount]);
        }
    }
}