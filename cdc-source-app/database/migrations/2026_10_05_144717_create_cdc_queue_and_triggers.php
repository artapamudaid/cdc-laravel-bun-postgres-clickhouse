<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // 1. Buat Tabel Antrean (Queue)
        Schema::create('cdc_queue', function (Blueprint $table) {
            $table->id();
            $table->string('table_name', 50);
            $table->unsignedBigInteger('record_id');
            $table->string('action', 10); // INSERT, UPDATE, DELETE
            $table->boolean('processed')->default(false);
            $table->timestamp('created_at')->useCurrent();
            
            // Index sangat penting agar Bun Worker bisa mengambil data dengan cepat
            $table->index(['processed', 'created_at']); 
        });

        // 2. Buat Function Trigger (Generic)
        DB::unprepared("
            CREATE OR REPLACE FUNCTION fn_cdc_capture()
            RETURNS TRIGGER AS \$\$
            BEGIN
                -- Masukkan catatan perubahan ke tabel cdc_queue
                INSERT INTO cdc_queue (table_name, record_id, action)
                VALUES (
                    TG_TABLE_NAME,
                    COALESCE(NEW.id, OLD.id), -- NEW untuk INSERT/UPDATE, OLD untuk DELETE
                    TG_OP
                );
                
                -- Kembalikan data agar operasi asli (INSERT/UPDATE/DELETE) tetap berhasil
                RETURN COALESCE(NEW, OLD);
            END;
            \$\$ LANGUAGE plpgsql;
        ");

        // 3. Pasang Trigger ke ke-5 Tabel
        $tables = ['customers', 'orders', 'order_details', 'journals', 'journal_details'];
        
        foreach ($tables as $table) {
            DB::unprepared("
                CREATE TRIGGER trg_{$table}_cdc
                AFTER INSERT OR UPDATE OR DELETE ON {$table}
                FOR EACH ROW EXECUTE FUNCTION fn_cdc_capture();
            ");
        }
    }

    public function down(): void
    {
        // Hapus Trigger
        $tables = ['customers', 'orders', 'order_details', 'journals', 'journal_details'];
        foreach ($tables as $table) {
            DB::unprepared("DROP TRIGGER IF EXISTS trg_{$table}_cdc ON {$table};");
        }

        // Hapus Function
        DB::unprepared("DROP FUNCTION IF EXISTS fn_cdc_capture();");

        // Hapus Tabel Antrean
        Schema::dropIfExists('cdc_queue');
    }
};