-- Online payment (Razorpay) ke liye zaroori columns aur settings.
-- Ek baar chalayein:  npx wrangler d1 execute naya-andaz-salon --remote --file=migration_add_payments.sql

ALTER TABLE bookings ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'salon';
ALTER TABLE bookings ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE bookings ADD COLUMN amount_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN razorpay_order_id TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN razorpay_payment_id TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('online_discount_percent', '10');
INSERT OR IGNORE INTO settings (key, value) VALUES ('online_payment_enabled', '1');
