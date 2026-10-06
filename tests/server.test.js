"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { spawn } = require("node:child_process"),
  fs = require("node:fs"),
  path = require("node:path"),
  { DatabaseSync } = require("node:sqlite");
const root = path.join(__dirname, ".."),
  port = 3119,
  origin = `http://127.0.0.1:${port}`,
  dbFile = path.join(root, "artifacts", `api-test-${Date.now()}.sqlite`);
let server;
async function start() {
  server = spawn(process.execPath, ["src/server/main.cjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DB_PATH: dbFile },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", (c) => reject(Error("server " + c)));
  });
}
async function stop() {
  if (server && !server.killed) {
    const p = new Promise((r) => server.once("exit", r));
    server.kill();
    await p;
  }
}
async function req(route, method = "GET", data, session = {}, headers = {}) {
  const r = await fetch(origin + "/api" + route, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(session.cookie ? { Cookie: session.cookie } : {}),
      ...(session.csrf ? { "X-CSRF-Token": session.csrf } : {}),
      ...headers,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const b = await r.json();
  return {
    status: r.status,
    body: b,
    cookie: r.headers.get("set-cookie")?.split(";")[0],
    csrf: b.csrf,
  };
}
test("server authentication, authorization, persistence and validation", async (t) => {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  await start();
  try {
    const password = "Local-test-password-2026";
    let a, b, id, runId;
    const c = require("../src/domain/reference.cjs").DEFAULT;
    await t.test("anonymous access and unsafe origin rejected", async () => {
      assert.equal((await req("/scenarios")).status, 401);
      assert.equal(
        (
          await req(
            "/auth/register",
            "POST",
            {},
            {},
            { Origin: "https://evil.invalid" },
          )
        ).status,
        403,
      );
      const r = await fetch(origin + "/.git/config");
      assert.equal(r.status, 404);
    });
    await t.test(
      "accounts have secure hashes and HttpOnly strict sessions",
      async () => {
        const data = {
          email: "first@example.test",
          name: "First user",
          password,
          language: "ru",
        };
        a = await req("/auth/register", "POST", data);
        assert.equal(a.status, 201);
        b = await req("/auth/register", "POST", {
          ...data,
          email: "second@example.test",
        });
        assert.equal(b.status, 201);
        assert.equal((await req("/auth/register", "POST", data)).status, 409);
        const db = new DatabaseSync(dbFile),
          u = db
            .prepare("SELECT password_hash FROM users WHERE id=?")
            .get(a.body.user.id);
        assert.match(u.password_hash, /^scrypt\$16384\$8\$1\$/);
        assert.ok(!u.password_hash.includes(password));
        const token = db
          .prepare("SELECT token_hash FROM sessions WHERE user_id=?")
          .get(a.body.user.id).token_hash;
        assert.notEqual(token, a.cookie.split("=")[1]);
        assert.equal(
          db.prepare("SELECT count(*) n FROM schema_migrations").get().n,
          2,
        );
        db.close();
        const response = await fetch(origin + "/api/auth/login", {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({ email: data.email, password }),
        });
        const set = response.headers.get("set-cookie");
        assert.match(set, /HttpOnly/);
        assert.match(set, /SameSite=Strict/);
        assert.equal(
          (
            await req("/auth/login", "POST", {
              email: data.email,
              password: "wrong",
            })
          ).status,
          401,
        );
      },
    );
    await t.test(
      "CSRF enforced; owner creates and edits own scenario",
      async () => {
        assert.equal(
          (
            await req(
              "/scenarios",
              "POST",
              { name: "Demo", config: c },
              { cookie: a.cookie },
            )
          ).status,
          403,
        );
        const r = await req(
          "/scenarios",
          "POST",
          { name: "Delivery plan", config: c },
          a,
        );
        assert.equal(r.status, 201);
        id = r.body.id;
        assert.equal(
          (
            await req(
              "/scenarios/" + id,
              "PUT",
              { name: "Edited plan", config: c },
              a,
            )
          ).status,
          200,
        );
        assert.equal(
          (await req("/scenarios", "GET", null, b)).body.scenarios.length,
          0,
        );
      },
    );
    await t.test(
      "cross-account scenario writes and calculations are denied",
      async () => {
        assert.equal(
          (
            await req(
              "/scenarios/" + id,
              "PUT",
              { name: "Stolen", config: c },
              b,
            )
          ).status,
          404,
        );
        assert.equal(
          (await req("/simulate", "POST", { scenarioId: id, save: true }, b))
            .status,
          404,
        );
      },
    );
    await t.test(
      "native result and historical snapshot saved independently",
      async () => {
        const r = await req(
          "/simulate",
          "POST",
          { scenarioId: id, save: true },
          a,
        );
        assert.equal(r.status, 200);
        assert.equal(r.body.result.snapshot.shipped, 28);
        runId = r.body.runId;
        assert.ok(runId);
        assert.equal((await req("/runs/" + runId, "GET", null, b)).status, 404);
        const changed = structuredClone(c);
        changed.operators = 3;
        await req(
          "/scenarios/" + id,
          "PUT",
          { name: "Modified later", config: changed },
          a,
        );
        const old = (await req("/runs/" + runId, "GET", null, a)).body;
        assert.equal(old.config.operators, 2);
        assert.equal(old.result.result.snapshot.orders[0].completedAt, 18000);
      },
    );
    await t.test(
      "unsafe configurations, profile and passwords rejected",
      async () => {
        assert.equal(
          (
            await req(
              "/simulate",
              "POST",
              { config: { ...c, cycles: [0, 600, 420] } },
              a,
            )
          ).status,
          400,
        );
        assert.equal(
          (await req("/simulate", "POST", { config: c, until: 28801 }, a))
            .status,
          400,
        );
        assert.equal(
          (await req("/me", "PUT", { name: "Valid", language: "xx" }, a))
            .status,
          400,
        );
        assert.equal(
          (
            await req(
              "/me",
              "PUT",
              {
                name: "Valid",
                language: "en",
                newPassword: "Another-safe-password",
                currentPassword: "wrong",
              },
              a,
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "concurrent native worker requests remain isolated",
      async () => {
        const { run } = require("../src/domain/reference.cjs");
        const configs = Array.from({ length: 6 }, (_, i) => ({
          ...structuredClone(c),
          seed: i,
          operators: i % 2 ? 3 : 2,
        }));
        const replies = await Promise.all(
          configs.map((config) => req("/simulate", "POST", { config }, a)),
        );
        replies.forEach((r, i) => {
          assert.equal(r.status, 200);
          assert.deepEqual(r.body.result.snapshot, run(configs[i]));
        });
        assert.equal((await req("/health")).status, 200);
      },
    );
    await t.test(
      "API rejects narrowing overflow before calling native",
      async () => {
        const r = await req(
          "/simulate",
          "POST",
          { config: { ...structuredClone(c), shipEvery: 4294967596 } },
          a,
        );
        assert.equal(r.status, 400);
        assert.equal(r.body.error, "invalid_config");
        assert.equal(
          (await req("/simulate", "POST", { scenarioId: 9007199254740992 }, a))
            .status,
          400,
        );
      },
    );
    await t.test(
      "HTTP body keeps UTF-8 characters split between TCP writes",
      async () => {
        const http = require("node:http"),
          payload = Buffer.from(
            JSON.stringify({ name: "Жанар", language: "kk" }),
          );
        const split = payload.indexOf(Buffer.from("Ж")) + 1;
        const response = await new Promise((resolve, reject) => {
          const request = http.request(
            origin + "/api/me",
            {
              method: "PUT",
              agent: false,
              headers: {
                Origin: origin,
                Cookie: a.cookie,
                "X-CSRF-Token": a.csrf,
                "Content-Type": "application/json",
                "Content-Length": payload.length,
              },
            },
            (res) => {
              const chunks = [];
              res.on("data", (b) => chunks.push(b));
              res.on("end", () =>
                resolve({
                  status: res.statusCode,
                  body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
                }),
              );
            },
          );
          request.on("error", reject);
          request.setTimeout(5000, () => request.destroy(Error("timeout")));
          request.on("socket", (socket) => socket.setNoDelay(true));
          request.flushHeaders();
          request.write(payload.subarray(0, split));
          setTimeout(() => request.end(payload.subarray(split)), 40);
        });
        assert.equal(response.status, 200);
        assert.equal(response.body.user.name, "Жанар");
        assert.equal(
          (await req("/me", "GET", null, a)).body.user.name,
          "Жанар",
        );
        const malformed = Buffer.concat([
          Buffer.from('{"name":"'),
          Buffer.from([0xd0]),
          Buffer.from('name","language":"kk"}'),
        ]);
        const bad = await fetch(origin + "/api/me", {
          method: "PUT",
          headers: {
            Origin: origin,
            Cookie: a.cookie,
            "X-CSRF-Token": a.csrf,
            "Content-Type": "application/json",
          },
          body: malformed,
        });
        assert.equal(bad.status, 400);
      },
    );
    await t.test(
      "large native Russian journals match reference over six worker runs",
      async () => {
        const config = {
          ...structuredClone(c),
          cycles: [30, 30, 30],
          operators: 3,
          stock: { body: 1000, engine: 1000, wheels: 4000 },
          deliveries: [],
          failures: [],
          shifts: [[0, 28800]],
          orders: [{ id: "Большой заказ", qty: 1000, due: 28800 }],
          qualityFail: 0,
        };
        const expected = require("../src/domain/reference.cjs").run(config);
        for (let i = 0; i < 6; i++) {
          const r = await req("/simulate", "POST", { config }, a);
          assert.equal(r.status, 200);
          assert.deepEqual(r.body.result.snapshot, expected);
          assert.ok(
            !JSON.stringify(r.body.result.snapshot.log).includes("\uFFFD"),
          );
        }
      },
    );
    await t.test(
      "save and simulate reject lone surrogates but preserve paired emoji",
      async () => {
        const before = (await req("/scenarios", "GET", null, a)).body.scenarios;
        for (const invalidId of ["\ud800", "\udc00"]) {
          const config = structuredClone(c);
          config.orders[0].id = invalidId;
          for (const [route, method, data] of [
            ["/scenarios", "POST", { name: "Invalid Unicode", config }],
            ["/scenarios/" + id, "PUT", { name: "Invalid Unicode", config }],
            ["/simulate", "POST", { config }],
          ]) {
            const r = await req(route, method, data, a);
            assert.equal(r.status, 400);
            assert.equal(r.body.error, "invalid_config");
          }
        }
        assert.deepEqual(
          (await req("/scenarios", "GET", null, a)).body.scenarios,
          before,
        );
        const config = structuredClone(c);
        config.orders[0].id = "Order \ud83d\ude97";
        const saved = await req(
          "/scenarios",
          "POST",
          { name: "Valid Unicode", config },
          a,
        );
        assert.equal(saved.status, 201);
        assert.equal(saved.body.config.orders[0].id, config.orders[0].id);
        const simulated = await req(
          "/simulate",
          "POST",
          { scenarioId: saved.body.id },
          a,
        );
        assert.equal(simulated.status, 200);
        assert.equal(
          simulated.body.result.snapshot.orders[0].id,
          config.orders[0].id,
        );
        assert.deepEqual(
          simulated.body.result.snapshot,
          require("../src/domain/reference.cjs").run(config),
        );
      },
    );
    await t.test("factory data is validated, isolated and persisted",async()=>{
      const d=structuredClone(require('../src/domain/factory.cjs').DEFAULT);
      assert.equal((await req('/factory')).status,401);
      d.performance[0].actual=117;
      assert.equal((await req('/factory','PUT',{dataset:d},a)).status,200);
      assert.equal((await req('/factory','GET',null,a)).body.dataset.performance[0].actual,117);
      assert.equal((await req('/factory','GET',null,b)).body.dataset.performance[0].actual,118);
      d.allocations=[{date:'2026-10-01',model:'Chevrolet Onix',quantity:999}];
      assert.equal((await req('/factory','PUT',{dataset:d},a)).status,400);
      await stop();await start();
      assert.equal((await req('/factory','GET',null,a)).body.dataset.performance[0].actual,117);
    });
    await t.test('decision endpoints enforce authentication, CSRF and native comparisons',async()=>{
      assert.equal((await req('/decisions','POST',{kind:'assess',config:c,until:0})).status,401);
      assert.equal((await req('/decisions','POST',{kind:'assess',config:c,until:0},{cookie:a.cookie})).status,403);
      const r=await req('/decisions','POST',{kind:'recommend',config:c,until:0},a);
      assert.equal(r.status,200);assert.ok(r.body.options.length<=3);assert.ok(r.body.assessment.current);
      assert.equal((await req('/decisions','POST',{kind:'assess',config:c,until:-1},a)).status,400);
    });
    await t.test("profile persists through server restart", async () => {
      assert.equal(
        (await req("/me", "PUT", { name: "Updated user", language: "kk" }, a))
          .status,
        200,
      );
      await stop();
      await start();
      const r = await req("/me", "GET", null, a);
      assert.equal(r.body.user.name, "Updated user");
      assert.equal(r.body.user.language, "kk");
      assert.equal(
        (await req("/scenarios", "GET", null, a)).body.scenarios.length,
        2,
      );
      assert.equal((await req("/runs", "GET", null, a)).body.runs.length, 1);
    });
    await t.test("password change and logout revoke access", async () => {
      assert.equal(
        (
          await req(
            "/me",
            "PUT",
            {
              name: "Updated user",
              language: "kk",
              currentPassword: password,
              newPassword: "Changed-password-2026",
            },
            a,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await req("/auth/login", "POST", {
            email: "first@example.test",
            password,
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await req("/auth/login", "POST", {
            email: "first@example.test",
            password: "Changed-password-2026",
          })
        ).status,
        200,
      );
      assert.equal((await req("/auth/logout", "POST", {}, a)).status, 200);
      assert.equal((await req("/me", "GET", null, a)).status, 401);
    });
  } finally {
    await stop();
  }
});
