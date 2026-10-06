<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class JournalDetail extends Model
{
    public function journal() {
        return $this->belongsTo(Journal::class);
    }
}
