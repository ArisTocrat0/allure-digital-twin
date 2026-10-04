"use strict";
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.join(__dirname, "../.."),
  db = require("./database.cjs")(root),
  auth = require("./auth.cjs"),
  v = require("./validation.cjs"),
  simulate = require("./simulation.cjs");
const port = Number(process.env.PORT || 3000),
  limits = new Map();
function rate(req, kind, max) {
  const key = kind + req.socket.remoteAddress,
    now = Date.now();
  let item = limits.get(key);
  if (!item || item.end < now) {
    item = { n: 0, end: now + 60000 };
    limits.set(key, item);
  }
  if (++item.n > max)
    throw Object.assign(Error("rate_limited"), { status: 429 });
}
function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
async function body(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 64000)
      throw Object.assign(Error("body_too_large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    // Decode once, after framing is complete; reject malformed UTF-8 rather than store replacement text.
    const result = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, bytes),
    );
    return JSON.parse(result || "{}");
  } catch {
    v.fail("invalid_json");
  }
}
function session(req) {
  const match = (req.headers.cookie || "").match(
    /(?:^|;\s*)allur_session=([a-f0-9]{64})(?:;|$)/,
  );
  if (!match) return null;
  return db
    .prepare(
      "SELECT sessions.*,users.email,users.name,users.language FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?",
    )
    .get(auth.digest(match[1]), Date.now());
}
function user(s) {
  return { id: s.user_id, email: s.email, name: s.name, language: s.language };
}
function newSession(res, u) {
  const token = auth.token(),
    csrf = auth.token();
  db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
    auth.digest(token),
    u.id,
    csrf,
    Date.now() + 8 * 3600000,
  );
  res.setHeader(
    "Set-Cookie",
    `allur_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
  );
  return {
    user: { id: u.id, email: u.email, name: u.name, language: u.language },
    csrf,
  };
}
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  try {
    const host = req.headers.host;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host))
      return json(res, 403, { error: "invalid_host" });
    const url = new URL(req.url, `http://${host}`),
      route = url.pathname,
      method = req.method,
      write = ["POST", "PUT", "DELETE"].includes(method);
    if (write && req.headers.origin !== `http://${host}`)
      return json(res, 403, { error: "invalid_origin" });
    if (route === "/api/health")
      return json(res, 200, {
        status: "ok",
        engine: fs.existsSync(
          path.join(
            root,
            "build",
            process.platform === "win32" ? "twin.exe" : "twin",
          ),
        )
          ? "cpp17"
          : "missing",
        database: "sqlite",
        synthetic: true,
      });
    if (route === "/api/auth/register" && method === "POST") {
      rate(req, "auth", 20);
      const b = await body(req),
        a = v.account(b),
        p = v.password(b.password);
      if (db.prepare("SELECT id FROM users WHERE email=?").get(a.email))
        return json(res, 409, { error: "email_exists" });
      const hash = await auth.hashPassword(p);
      let id;
      try {
        id = Number(
          db
            .prepare(
              "INSERT INTO users(email,name,password_hash,language,created_at) VALUES(?,?,?,?,?)",
            )
            .run(a.email, a.name, hash, a.language, Date.now()).lastInsertRowid,
        );
      } catch (e) {
        if (String(e).includes("UNIQUE"))
          return json(res, 409, { error: "email_exists" });
        throw e;
      }
      return json(res, 201, newSession(res, { ...a, id }));
    }
    if (route === "/api/auth/login" && method === "POST") {
      rate(req, "auth", 20);
      const b = await body(req);
      if (
        typeof b.email !== "string" ||
        typeof b.password !== "string" ||
        b.password.length > 128
      )
        v.fail();
      const u = db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(b.email.trim().toLowerCase());
      const dummy =
        "scrypt$16384$8$1$00000000000000000000000000000000$" + "00".repeat(64);
      const valid = await auth.verifyPassword(
        b.password,
        u?.password_hash || dummy,
      );
      if (!u || !valid) return json(res, 401, { error: "invalid_credentials" });
      const current = session(req);
      if (current)
        db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
          current.token_hash,
        );
      return json(res, 200, newSession(res, u));
    }
    if (route.startsWith("/api/")) {
      const s = session(req);
      if (!s) return json(res, 401, { error: "unauthorized" });
      if (write && req.headers["x-csrf-token"] !== s.csrf)
        return json(res, 403, { error: "csrf" });
      if (route === "/api/me" && method === "GET")
        return json(res, 200, { user: user(s), csrf: s.csrf });
      if (route === "/api/auth/logout" && method === "POST") {
        db.prepare("DELETE FROM sessions WHERE token_hash=?").run(s.token_hash);
        res.setHeader(
          "Set-Cookie",
          "allur_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        return json(res, 200, { ok: true });
      }
      if (route === "/api/me" && method === "PUT") {
        const b = await body(req),
          a = v.account({ ...b, email: s.email });
        if (b.newPassword) {
          v.password(b.newPassword);
          const row = db
            .prepare("SELECT password_hash FROM users WHERE id=?")
            .get(s.user_id);
          if (
            typeof b.currentPassword !== "string" ||
            b.currentPassword.length > 128 ||
            !(await auth.verifyPassword(b.currentPassword, row.password_hash))
          )
            return json(res, 403, { error: "invalid_credentials" });
          const hash = await auth.hashPassword(b.newPassword);
          db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
            hash,
            s.user_id,
          );
          db.prepare(
            "DELETE FROM sessions WHERE user_id=? AND token_hash<>?",
          ).run(s.user_id, s.token_hash);
        }
        db.prepare("UPDATE users SET name=?,language=? WHERE id=?").run(
          a.name,
          a.language,
          s.user_id,
        );
        return json(res, 200, { user: { id: s.user_id, ...a }, csrf: s.csrf });
      }
      if (route === "/api/templates" && method === "GET")
        return json(res, 200, {
          templates: ["base", "delay", "breakdown", "operator", "expedite"].map(
            (key) => ({ key, config: v.scenario(v.DEFAULT, key) }),
          ),
        });
      if (route === "/api/scenarios" && method === "GET")
        return json(res, 200, {
          scenarios: db
            .prepare(
              "SELECT id,name,config,updated_at FROM scenarios WHERE user_id=? ORDER BY updated_at DESC",
            )
            .all(s.user_id)
            .map((x) => ({ ...x, config: JSON.parse(x.config) })),
        });
      if (route === "/api/scenarios" && method === "POST") {
        const b = v.scenarioInput(await body(req));
        if (
          db
            .prepare("SELECT count(*) n FROM scenarios WHERE user_id=?")
            .get(s.user_id).n >= 100
        )
          return json(res, 409, { error: "scenario_limit" });
        const now = Date.now(),
          id = Number(
            db
              .prepare(
                "INSERT INTO scenarios(user_id,name,config,created_at,updated_at) VALUES(?,?,?,?,?)",
              )
              .run(s.user_id, b.name, JSON.stringify(b.config), now, now)
              .lastInsertRowid,
          );
        return json(res, 201, { id, ...b });
      }
      const match = route.match(/^\/api\/scenarios\/(\d+)$/);
      if (match && method === "PUT") {
        const row = db
          .prepare("SELECT id FROM scenarios WHERE id=? AND user_id=?")
          .get(v.recordId(Number(match[1])), s.user_id);
        if (!row) return json(res, 404, { error: "not_found" });
        const b = v.scenarioInput(await body(req));
        db.prepare(
          "UPDATE scenarios SET name=?,config=?,updated_at=? WHERE id=? AND user_id=?",
        ).run(b.name, JSON.stringify(b.config), Date.now(), row.id, s.user_id);
        return json(res, 200, { id: row.id, ...b });
      }
      if (route === "/api/simulate" && method === "POST") {
        rate(req, "simulation", 120);
        const b = await body(req);
        let config,
          name = "";
        if (b.scenarioId !== undefined && b.scenarioId !== null) {
          v.recordId(b.scenarioId);
          const row = db
            .prepare("SELECT * FROM scenarios WHERE id=? AND user_id=?")
            .get(b.scenarioId, s.user_id);
          if (!row) return json(res, 404, { error: "not_found" });
          config = v.configuration(JSON.parse(row.config));
          name = row.name;
        } else config = v.configuration(b.config);
        const until = b.until ?? config.horizon;
        if (!Number.isSafeInteger(until) || until < 0 || until > config.horizon)
          v.fail();
        const baseline = structuredClone(v.DEFAULT);
        baseline.seed = config.seed;
        baseline.horizon = config.horizon;
        const result = await simulate(config, until),
          base = await simulate(baseline, until);
        let runId = null;
        if (b.save === true) {
          runId = Number(
            db
              .prepare(
                "INSERT INTO runs(user_id,scenario_id,name,config,result,created_at) VALUES(?,?,?,?,?,?)",
              )
              .run(
                s.user_id,
                b.scenarioId || null,
                name,
                JSON.stringify(config),
                JSON.stringify({ result, baseline: base }),
                Date.now(),
              ).lastInsertRowid,
          );
        }
        return json(res, 200, { result, baseline: base, runId });
      }
      if (route === "/api/runs" && method === "GET")
        return json(res, 200, {
          runs: db
            .prepare(
              "SELECT id,name,created_at,scenario_id FROM runs WHERE user_id=? ORDER BY id DESC LIMIT 30",
            )
            .all(s.user_id),
        });
      const runMatch = route.match(/^\/api\/runs\/(\d+)$/);
      if (runMatch && method === "GET") {
        const row = db
          .prepare("SELECT * FROM runs WHERE id=? AND user_id=?")
          .get(v.recordId(Number(runMatch[1])), s.user_id);
        if (!row) return json(res, 404, { error: "not_found" });
        return json(res, 200, {
          ...row,
          config: JSON.parse(row.config),
          result: JSON.parse(row.result),
        });
      }
      return json(res, 404, { error: "not_found" });
    }
    if (method !== "GET")
      return json(res, 405, { error: "method_not_allowed" });
    const files = {
      "/": "index.html",
      "/app.js": "app.js",
      "/style.css": "style.css",
      "/i18n.js": "i18n.js",
    };
    const file = files[route];
    if (!file) return json(res, 404, { error: "not_found" });
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : file.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "text/html; charset=utf-8",
    );
    fs.createReadStream(path.join(root, "src/web", file)).pipe(res);
  } catch (e) {
    json(res, e.status || 500, {
      error: e.status ? e.message : "internal_error",
    });
    if (!e.status) console.error("Request failed:", e.code || e.message);
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`ALLUR C++ / SQLite: http://127.0.0.1:${port}`),
);
module.exports = server;
