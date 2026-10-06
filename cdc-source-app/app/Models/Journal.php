<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Journal extends Model
{
    public function order() {
        return $this->belongsTo(Order::class);
    }
    public function details() {
        return $this->hasMany(JournalDetail::class);
    }
}
