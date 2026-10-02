ALTER TABLE users
  ADD COLUMN IF NOT EXISTS premium_until TIMESTAMP,
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  telegram_payment_charge_id TEXT NOT NULL UNIQUE,
  invoice_payload TEXT NOT NULL,
  plan_code VARCHAR(64) NOT NULL,
  currency VARCHAR(8) NOT NULL,
  total_amount INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'paid',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  raw_payment JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_payments_user_created
  ON payments(user_id, created_at DESC);
