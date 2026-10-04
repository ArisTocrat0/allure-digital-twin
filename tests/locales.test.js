"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
test("all RU/KK/EN interface keys exist and English contains no Cyrillic", () => {
  const context = { window: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../src/web/i18n.js"), "utf8"),
    context,
  );
  const d = context.window.I18N;
  assert.deepEqual(Object.keys(d.ru).sort(), Object.keys(d.en).sort());
  assert.deepEqual(Object.keys(d.ru).sort(), Object.keys(d.kk).sort());
  for (const [locale, dict] of Object.entries(d))
    for (const [key, value] of Object.entries(dict)) {
      assert.ok(value.trim(), locale + ":" + key);
      if (locale === "en") assert.ok(!/[А-Яа-яЁё]/.test(value), key);
    }
});
