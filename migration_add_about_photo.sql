-- Sirf unke liye jinhone pehle wali migration_add_photos_and_settings.sql
-- ALREADY chala li hai. Agar abhi tak nahi chalayi, to iski zaroorat nahi —
-- naya migration_add_photos_and_settings.sql (updated) hi kaafi hai.

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('about_image_key', '');
