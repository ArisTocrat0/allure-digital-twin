"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { performance } = require("node:perf_hooks"),
  { spawnSync } = require("node:child_process"),
  { DEFAULT, run } = require("../src/domain/reference.cjs");
const repeat = 500,
  samples = [];
for (let i = 0; i < 500; i++) run(DEFAULT);
for (let sample = 0; sample < 5; sample++) {
  let start = performance.now();
  for (let i = 0; i < repeat; i++) run(DEFAULT);
  const jsMs = performance.now() - start;
  start = performance.now();
  const p = spawnSync(
    path.join(
      __dirname,
      "../build",
      process.platform === "win32" ? "twin.exe" : "twin",
    ),
    [],
    {
      input: JSON.stringify({ config: DEFAULT, repeat }) + "\n",
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (p.status !== 0) throw Error(p.stderr);
  const nativeWallMs = performance.now() - start,
    data = JSON.parse(p.stdout);
  if (data.error) throw Error(data.error);
  samples.push({ jsMs, nativeMs: data.elapsedMs, nativeWallMs });
}
const median = (key) => samples.map((s) => s[key]).sort((a, b) => a - b)[2];
const report = {
  date: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  compiler: "Zig 0.15.2 C++17 -O3 -DNDEBUG",
  repeat,
  samples,
  median: {
    jsMs: median("jsMs"),
    nativeMs: median("nativeMs"),
    nativeWallMs: median("nativeWallMs"),
  },
  computeSpeedup: median("jsMs") / median("nativeMs"),
  wallSpeedup: median("jsMs") / median("nativeWallMs"),
  scope:
    "500 independent eight-hour baseline runs per batch; full snapshots/logs constructed every run, only the final native snapshot is serialized and returned; one native process per batch; native startup/final output included only in wall time; JS warmed up; no HTTP/DB/UI measurement",
};
fs.mkdirSync(path.join(__dirname, "../docs"), { recursive: true });
fs.writeFileSync(
  path.join(__dirname, "../docs/benchmark.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
