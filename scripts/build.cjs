"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
fs.mkdirSync(path.join(root, "build"), { recursive: true });
const zig = path.join(root, "tools", "zig-x86_64-windows-0.15.2", "zig.exe");
const compiler = process.env.CXX || (fs.existsSync(zig) ? zig : "c++");
const flags = [
  ...(compiler.endsWith("zig.exe") ? ["c++"] : []),
  "-std=c++17",
  "-O3",
  "-DNDEBUG",
  "src/simulation/main.cpp",
  "-o",
  process.platform === "win32" ? "build/twin.exe" : "build/twin",
];
const r = spawnSync(compiler, flags, { cwd: root, stdio: "inherit" });
if (r.error) throw r.error;
process.exit(r.status ?? 1);
