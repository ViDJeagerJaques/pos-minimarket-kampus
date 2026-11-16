CREATE TABLE checkout_attempt_quotes (
    attempt_key TEXT PRIMARY KEY REFERENCES checkout_attempts(attempt_key),
    quote_json TEXT NOT NULL
) STRICT;

