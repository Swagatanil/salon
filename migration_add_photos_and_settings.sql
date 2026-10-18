-- Ek baar chalane wali migration: photo upload, "salon band" notice,
-- aur gallery feature ke liye zaroori tables/columns add karta hai.

ALTER TABLE services ADD COLUMN image_key TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('notice_active', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notice_text', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('hero_image_key', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('about_image_key', '');

CREATE TABLE IF NOT EXISTS gallery_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Photos yahan base64 text ke roop mein store hoti hain (koi R2/paid storage nahi chahiye).
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
