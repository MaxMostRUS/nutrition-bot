CREATE TABLE IF NOT EXISTS tribute_payments (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purchase_id BIGINT NOT NULL UNIQUE,
  product_id BIGINT NOT NULL,
  telegram_user_id BIGINT NOT NULL,
  amount INT,
  currency VARCHAR(16),
  event_name VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'paid',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  raw_event JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tribute_payments_user_created
  ON tribute_payments(user_id, created_at DESC);
