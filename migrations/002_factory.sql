CREATE TABLE IF NOT EXISTS factory_datasets(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, dataset TEXT NOT NULL, updated_at INTEGER NOT NULL);
INSERT OR IGNORE INTO schema_migrations VALUES(2,unixepoch());
