-- BUG-232: catatan/alasan selisih pada penutupan shift; skema lama tidak diubah.
ALTER TABLE shift_closings ADD COLUMN variance_note TEXT CHECK (variance_note IS NULL OR length(trim(variance_note)) BETWEEN 1 AND 500);
