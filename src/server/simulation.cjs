"use strict";
// Two persistent, isolated JSON-lines workers. Calculations never run on Node's event loop.
const { spawn } = require("node:child_process"),
  path = require("node:path");
const executable = path.join(
  __dirname,
  "../../build",
  process.platform === "win32" ? "twin.exe" : "twin",
);
const workers = Array.from({ length: 2 }, () => ({
    child: null,
    job: null,
    buffer: "",
  })),
  queue = [];
function release(worker, error, value) {
  const job = worker.job;
  if (!job) return;
  worker.job = null;
  clearTimeout(job.timer);
  error ? job.reject(error) : job.resolve(value);
  setImmediate(dispatch);
}
function reset(worker, error) {
  const child = worker.child;
  worker.child = null;
  worker.buffer = "";
  if (child) child.kill();
  release(worker, error);
}
function start(worker) {
  const child = spawn(executable, [], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  worker.child = child;
  child.stdout.on("data", (chunk) => {
    if (worker.child !== child) return;
    worker.buffer += chunk;
    if (worker.buffer.length > 8 * 1024 * 1024)
      return reset(worker, Error("output_limit"));
    let newline;
    while ((newline = worker.buffer.indexOf("\n")) >= 0) {
      const line = worker.buffer.slice(0, newline);
      worker.buffer = worker.buffer.slice(newline + 1);
      try {
        const r = JSON.parse(line);
        if (r.error) throw Error("engine_failed");
        release(worker, null, r);
      } catch (e) {
        reset(worker, e);
        break;
      }
    }
  });
  child.stderr.resume();
  child.stdin.on("error", () => {});
  child.on("error", () => {
    if (worker.child === child)
      reset(
        worker,
        Object.assign(Error("engine_unavailable"), { status: 503 }),
      );
  });
  child.on("close", () => {
    if (worker.child === child)
      reset(
        worker,
        Object.assign(Error("engine_unavailable"), { status: 503 }),
      );
  });
}
function dispatch() {
  for (const worker of workers) {
    if (worker.job || !queue.length) continue;
    worker.job = queue.shift();
    worker.job.timer = setTimeout(
      () =>
        reset(
          worker,
          Object.assign(Error("simulation_timeout"), { status: 503 }),
        ),
      15000,
    );
    if (!worker.child) start(worker);
    worker.child.stdin.write(
      JSON.stringify({ config: worker.job.config, until: worker.job.until }) +
        "\n",
    );
  }
}
module.exports = function simulate(config, until) {
  return new Promise((resolve, reject) => {
    if (queue.length >= 8)
      return reject(Object.assign(Error("busy"), { status: 429 }));
    queue.push({ config, until, resolve, reject });
    dispatch();
  });
};
