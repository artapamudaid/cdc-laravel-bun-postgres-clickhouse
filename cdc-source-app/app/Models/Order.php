<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    public function customer() {
        return $this->belongsTo(Customer::class);
    }
    public function details() {
        return $this->hasMany(OrderDetail::class);
    }
    public function journal() {
        return $this->hasOne(Journal::class);
    }
}
