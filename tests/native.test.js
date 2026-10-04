"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { spawnSync } = require("node:child_process"),
  path = require("node:path");
const { DEFAULT, scenario, Twin } = require("../src/domain/reference.cjs");
const exe =
  process.env.NATIVE_TEST_EXE ||
  path.join(
    __dirname,
    "../build",
    process.platform === "win32" ? "twin.exe" : "twin",
  );
function native(requests) {
  const p = spawnSync(exe, [], {
    input: requests.map((r) => JSON.stringify(r)).join("\n") + "\n",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(p.status, 0, p.stderr);
  return p.stdout
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s).snapshot);
}
test("C++ equals JS complete snapshots/logs for all scenarios and 40 seeds", () => {
  const req = [];
  for (let seed = 0; seed < 40; seed++)
    for (const key of ["base", "delay", "breakdown", "operator", "expedite"])
      req.push({
        config: scenario({ ...structuredClone(DEFAULT), seed }, key),
      });
  const results = native(req);
  req.forEach((r, i) =>
    assert.deepEqual(
      results[i],
      new Twin(r.config).advance(r.config.horizon),
      `seed/scenario ${i}`,
    ),
  );
});
test("C++ chunked advance and terminal/quality edge cases match JS", () => {
  const req = [];
  for (let n = 0; n < 80; n++) {
    const c = structuredClone(DEFAULT);
    c.seed = n;
    c.horizon = 60 + (n % 10);
    c.shifts = [
      [0, 20],
      [30, 100],
    ];
    c.cycles = [2 + (n % 3), 3 + (n % 5), 2 + (n % 4)];
    c.bufferCaps = [1, 1];
    c.stock = { body: 8, engine: 8, wheels: 32 };
    c.deliveries = [
      { at: c.horizon, parts: { body: 4, engine: 4, wheels: 16 } },
    ];
    c.failures = [
      { at: 1, station: 0, duration: 2 },
      { at: 2, station: 0, duration: 4 },
    ];
    c.orders = [{ id: "T", qty: 10, due: c.horizon }];
    c.shipEvery = 5;
    c.qualityFail = n % 2 ? 1 : 0;
    c.reworkFail = n % 3 ? 0 : 1;
    req.push({
      config: c,
      targets: Array.from({ length: c.horizon + 1 }, (_, i) => i),
    });
  }
  const results = native(req);
  req.forEach((r, i) => {
    const m = new Twin(r.config);
    r.targets.forEach((t) => m.advance(t));
    assert.deepEqual(results[i], m.snapshot(), `case ${i}`);
  });
});
