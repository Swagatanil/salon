-- Sirf unke liye jinhone pehle wali migrations already chala li hain.
-- Isse naya 'logo_image_key' setting add hoga (future logo upload ke liye).

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('logo_image_key', '');
