"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { DatabaseSync } = require("node:sqlite");
module.exports = function (root) {
  const file = process.env.DB_PATH || path.join(root, "data", "allur.sqlite");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  db.exec(
    fs
      .readFileSync(path.join(root, "migrations", "001_initial.sql"), "utf8")
      .replace(/^\uFEFF/, ""),
  );
  db.exec(fs.readFileSync(path.join(root, 'migrations', '002_factory.sql'), 'utf8').replace(/^\uFEFF/, ''));
  return db;
};
