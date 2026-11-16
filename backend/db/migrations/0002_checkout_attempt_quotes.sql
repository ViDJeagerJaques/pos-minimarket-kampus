CREATE TABLE checkout_attempt_quotes (
    attempt_key TEXT PRIMARY KEY REFERENCES checkout_attempts(attempt_key),
    quote_json TEXT NOT NULL,
    cash_received_rp INTEGER CHECK (cash_received_rp IS NULL OR cash_received_rp >= 0),
    change_rp INTEGER CHECK (change_rp IS NULL OR change_rp >= 0)
) STRICT;

