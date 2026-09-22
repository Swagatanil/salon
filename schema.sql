-- Naya Andaz Salon backend schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL,
  icon TEXT NOT NULL DEFAULT '✂️',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  service TEXT NOT NULL,
  booking_date TEXT NOT NULL,
  booking_time TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings (booking_date, booking_time);
CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings (phone, created_at);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 5,
  message TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_approved ON feedback (approved, created_at);

INSERT OR IGNORE INTO services (name, description, price, icon, sort_order) VALUES
  ('Haircut', 'Scissor ya machine, aapki pasand', 80, '✂️', 1),
  ('Haircut + Wash', 'Shampoo ke saath poora package', 120, '🧴', 2),
  ('Beard Trim', 'Shape aur style ke saath', 50, '🪒', 3),
  ('Clean Shave', 'Ekdum smooth aur saaf', 40, '🧼', 4),
  ('Haircut + Beard Combo', 'Combo package, paisa vasool', 120, '💇', 5),
  ('Hair Colour', 'Grey hair ho ya style colour', 150, '🎨', 6),
  ('Head Massage', '20 minute ki champi, poora aaram', 100, '💆', 7),
  ('Kids Haircut', '10 saal tak ke bacchon ke liye', 60, '🧒', 8),
  ('Groom Package', 'Shaadi ke din ke liye special', 1500, '🤵', 9);
