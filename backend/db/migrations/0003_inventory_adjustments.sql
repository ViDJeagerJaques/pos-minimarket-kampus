-- TASK-039 / K-11: identitas retry koreksi stok; skema lama tidak diubah.
CREATE TABLE inventory_adjustments (
    adjustment_key TEXT PRIMARY KEY NOT NULL CHECK (length(trim(adjustment_key)) BETWEEN 1 AND 128),
    request_hash BLOB NOT NULL CHECK (length(request_hash) = 32),
    movement_id INTEGER NOT NULL UNIQUE REFERENCES inventory_movements(id),
    previous_on_hand INTEGER NOT NULL CHECK (previous_on_hand BETWEEN 0 AND 9007199254740991),
    on_hand INTEGER NOT NULL CHECK (on_hand BETWEEN 0 AND 9007199254740991),
    CHECK (previous_on_hand != on_hand)
) STRICT;
