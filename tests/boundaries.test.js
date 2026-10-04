"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { spawnSync } = require("node:child_process"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path"),
  { EventEmitter } = require("node:events"),
  { PassThrough } = require("node:stream");
const { DEFAULT } = require("../src/domain/reference.cjs"),
  { configuration } = require("../src/server/validation.cjs");
const fields = [
  ["seed", 4294967295],
  ["horizon", 28800],
  ["operators", 3],
  ["shipEvery", 604800],
  ["cycles.0", 3600],
  ["cycles.1", 3600],
  ["cycles.2", 3600],
  ["bufferCaps.0", 20],
  ["bufferCaps.1", 20],
  ["stock.body", 10000],
  ["stock.engine", 10000],
  ["stock.wheels", 10000],
  ["bom.body", 100],
  ["bom.engine", 100],
  ["bom.wheels", 100],
  ["deliveries.0.at", 604800],
  ["deliveries.0.parts.body", 10000],
  ["deliveries.0.parts.engine", 10000],
  ["deliveries.0.parts.wheels", 10000],
  ["failures.0.at", 604800],
  ["failures.0.station", 2],
  ["failures.0.duration", 86400],
  ["shifts.0.0", 604800],
  ["shifts.0.1", 604800],
  ["shifts.1.0", 604800],
  ["shifts.1.1", 604800],
  ["orders.0.qty", 1000],
  ["orders.0.due", 604800],
  ["orders.1.qty", 1000],
  ["orders.1.due", 604800],
];
function set(c, field, value) {
  const keys = field.split("."),
    last = keys.pop();
  let o = c;
  for (const key of keys) o = o[key];
  o[last] = value;
  return c;
}
function native(requests) {
  const exe =
    process.env.NATIVE_TEST_EXE ||
    path.join(
      __dirname,
      "../build",
      process.platform === "win32" ? "twin.exe" : "twin",
    );
  const p = spawnSync(exe, [], {
    input: requests.map((r) => JSON.stringify(r)).join("\n") + "\n",
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(p.status, 0, p.stderr);
  return p.stdout.trim().split("\n").map(JSON.parse);
}
test("API bounds every integer field before native narrowing", () => {
  for (const [field, max] of fields)
    for (const value of [
      max + 1,
      4294967596,
      Number.MAX_SAFE_INTEGER,
      -1,
      1.5,
      "1",
      true,
    ]) {
      const c = set(structuredClone(DEFAULT), field, value);
      assert.throws(
        () => configuration(c),
        { message: "invalid_config" },
        field + ":" + value,
      );
    }
  assert.equal(
    configuration({ ...structuredClone(DEFAULT), shipEvery: 604800 }).shipEvery,
    604800,
  );
});
test("native rejects out-of-range and noninteger fields plus until/repeat/targets", () => {
  const requests = [],
    labels = [];
  for (const [field, apiMax] of fields) {
    const max = field === "horizon" ? 604800 : apiMax;
    for (const value of [
      max + 1,
      4294967596,
      Number.MAX_SAFE_INTEGER,
      -1,
      1.5,
      "1",
      true,
    ]) {
      requests.push({
        config: set(structuredClone(DEFAULT), field, value),
        until: 0,
      });
      labels.push(field + ":" + value);
    }
  }
  for (const params of [
    { until: 4294967296 },
    { until: -1 },
    { until: 1.5 },
    { repeat: 4294967297 },
    { repeat: 0 },
    { repeat: "1" },
    { targets: [4294967296] },
    { targets: [1.5] },
  ]) {
    requests.push({ config: DEFAULT, ...params });
    labels.push(JSON.stringify(params));
  }
  native(requests).forEach((r, i) => assert.ok(r.error, labels[i]));
  const [valid] = native([
    { config: { ...structuredClone(DEFAULT), shipEvery: 604800 } },
  ]);
  assert.equal(valid.snapshot.shipped, 0);
});
test("native stdout decoding preserves UTF-8 split at every byte", async () => {
  const text = "Жанар — Қазақша: поставка 🚗",
    reply = Buffer.from(
      JSON.stringify({ snapshot: { log: [{ message: text }] } }) + "\n",
    );
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new EventEmitter();
    child.stdin.write = () => {
      for (const byte of reply) child.stdout.write(Buffer.from([byte]));
    };
    child.kill = () => {};
    return child;
  };
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../src/server/simulation.cjs"),
      "utf8",
    ),
    {
      module,
      process: { platform: process.platform },
      __dirname: path.join(__dirname, "../src/server"),
      require: (name) =>
        name === "node:child_process" ? { spawn: fakeSpawn } : require(name),
      setTimeout,
      clearTimeout,
      setImmediate,
      Buffer,
    },
  );
  const result = await module.exports(DEFAULT, 0);
  assert.equal(result.snapshot.log[0].message, text);
});
