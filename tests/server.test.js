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
          1,
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
        1,
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
