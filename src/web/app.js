"use strict";
const $ = (id) => document.getElementById(id),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let lang = localStorage.getItem("allur-language") || "ru";
if (!I18N[lang]) lang = "ru";
let me = null,
  csrf = "",
  templates = [],
  saved = [],
  history = [],
  config = null,
  scenarioId = null,
  templateKey = "base",
  scenarioName = "",
  result = null,
  baseResult = null,
  elapsed = 0,
  busy = false,
  registering = false;
const t = (key) => I18N[lang][key] || I18N[lang].error,
  clock = (v) =>
    [Math.floor(v / 3600), Math.floor(v / 60) % 60, v % 60]
      .map((x) => String(x).padStart(2, "0"))
      .join(":"),
  page = () =>
    ["overview", "line", "scenarios", "resources", "profile"].includes(
      location.hash.slice(1),
    )
      ? location.hash.slice(1)
      : "overview";
function notify(key, error = false) {
  $("notice").textContent = t(key);
  $("notice").className = error ? "error" : "";
}
async function api(url, { method = "GET", data } = {}) {
  const r = await fetch("/api" + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const b = await r.json();
  if (!r.ok) {
    if (r.status === 401 && me) {
      me = null;
      csrf = "";
      render();
    }
    throw Error(b.error || "error");
  }
  return b;
}
async function action(fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (e) {
    notify(e.message, true);
  } finally {
    busy = false;
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}
function language() {
  document.documentElement.lang = lang;
  $("language").value = lang;
  $("language-label").textContent = t("language");
  $("skip").textContent = t("skip");
  localStorage.setItem("allur-language", lang);
}
function authPage() {
  return `<main id="content" class="auth" tabindex="-1"><section><div class="eyebrow">QOSTANAI AI INDUSTRY HACKATHON 2026</div><h1>${t("welcome")}</h1><p>${t("intro")}</p><p class="muted">${t("accountHelp")}</p><div class="demo">${t("demo")}</div><p class="muted">${t("local")}</p></section><section class="panel"><h2>${t(registering ? "register" : "authTitle")}</h2><form id="auth-form">${registering ? `<label class="field">${t("name")}<input name="name" id="auth-name" autocomplete="name" minlength="2" maxlength="60" required></label>` : ""}<label class="field">${t("email")}<input name="email" id="auth-email" type="email" autocomplete="username" maxlength="254" required></label><label class="field">${t("password")}<input name="password" id="auth-password" type="password" autocomplete="${registering ? "new-password" : "current-password"}" minlength="${registering ? 12 : 1}" maxlength="128" required></label>${registering ? `<p class="muted">${t("passwordHelp")}</p>` : ""}<button class="primary" id="auth-submit">${t(registering ? "register" : "login")}</button></form><button class="switch" id="auth-switch">${t(registering ? "login" : "register")}</button></section></main>`;
}
function nav() {
  return `<nav aria-label="${t("app")}">${["overview", "line", "scenarios", "resources", "profile"].map((k) => `<a href="#${k}" ${page() === k ? 'aria-current="page"' : ""} class="${page() === k ? "active" : ""}">${t(k)}</a>`).join("")}<div class="account">${esc(me.name)}<br>${esc(me.email)}</div><button id="logout">${t("logout")}</button></nav>`;
}
function controls() {
  return `<div class="toolbar"><span class="clock">${t("time")}: ${clock(result?.t || 0)}</span><button data-calc="end" class="primary">${t("run")}</button><button data-calc="step">${t("step")}</button><button data-calc="reset">${t("reset")}</button><button data-calc="save">${t("saveRun")}</button></div><p class="muted">${scenarioName ? esc(scenarioName) : t(templateKey)} · ${t("elapsed")}: ${elapsed.toFixed(2)} ${t("ms")}</p>`;
}
function stats() {
  if (!result) return "";
  return `<div class="stats">${[
    ["produced", result.produced],
    ["shipped", result.shipped],
    ["finished", result.finished],
    ["wip", result.started - result.scrapped - result.produced],
  ]
    .map(
      ([k, n]) =>
        `<div class="stat"><span>${t(k)}</span><strong>${n}</strong><span>${t("units")}</span></div>`,
    )
    .join("")}</div>`;
}
function compare() {
  if (!result || !baseResult) return "";
  const timely = (s) =>
    s.orders.filter((o) => o.completedAt !== null && o.completedAt <= o.due)
      .length;
  const rows = [
    ["produced", baseResult.produced, result.produced],
    ["shipped", baseResult.shipped, result.shipped],
    ["scrapped", baseResult.scrapped, result.scrapped],
    ["ontime", timely(baseResult), timely(result)],
  ];
  return `<section class="panel"><h2>${t("compare")}</h2><div class="table-wrap"><table id="comparison"><thead><tr>${["metric", "baseline", "selected", "delta"].map((k) => `<th>${t(k)}</th>`).join("")}</tr></thead><tbody>${rows.map(([k, b, a]) => `<tr><td>${t(k)}</td><td>${b}</td><td>${a}</td><td>${a - b > 0 ? "+" : ""}${a - b}</td></tr>`).join("")}</tbody></table></div></section>`;
}
function overview() {
  return `<section class="hero"><div class="eyebrow">ALLUR / PRODUCTION LAB</div><h1>${t("welcome")}</h1><p>${t("intro")}</p></section>${controls()}${stats()}${compare()}<div class="grid"><section class="panel"><h2>${t("how")}</h2><p>${t("how1")}</p><p>${t("how2")}</p><p>${t("how3")}</p><a href="#line">${t("openLine")} →</a></section><section class="panel"><h2>${t("history")}</h2>${history.length ? history.map((r) => `<div class="list-item"><span>${esc(r.name || t("newScenario"))}<br><small>${new Date(r.created_at).toLocaleString(lang === "kk" ? "kk-KZ" : lang === "ru" ? "ru-RU" : "en-GB")}</small></span><button data-run="${r.id}">${t("view")}</button></div>`).join("") : `<p class="muted">${t("none")}</p>`}<p class="muted">${t("resultHelp")}</p></section></div>`;
}
function line() {
  if (!result) return "";
  return `<h1>${t("line")}</h1>${controls()}<div class="flow">${result.stations.map((s, i) => `${i ? `<div class="buffer">${t("buffer")} ${i}<strong>${result.buffers[i - 1].length} / ${config.bufferCaps[i - 1]}</strong>→</div>` : ""}<section class="station ${s.state}"><small>0${i + 1}</small><h2>${t("station" + i)}</h2><div class="status">${t(s.state === "operator" ? "operatorState" : s.state)}</div><div class="job">${s.job ? t("vehicle") + " #" + s.job.id : t("empty")}</div><progress aria-label="${t("worked")}" value="${s.job ? s.cycle - s.remaining : 0}" max="${s.cycle}"></progress><p class="muted">${t("remaining")}: ${s.remaining} ${t("seconds")}<br>${t("cycle")}: ${s.cycle} ${t("seconds")}</p>${s.job?.pendingRework ? `<p>${t("pending")}</p>` : ""}</section>`).join("")}</div>${stats()}<section class="panel"><h2>${t("diagnosis")}</h2><p>${t("bottleneck")} ${t("station" + config.cycles.indexOf(Math.max(...config.cycles)))} — ${Math.max(...config.cycles)} ${t("seconds")}.</p><div class="table-wrap"><table><thead><tr><th>${t("line")}</th>${["worked", "blockedTime", "starvedTime", "operatorTime", "repairTime"].map((k) => `<th>${t(k)}, ${t("minutes")}</th>`).join("")}</tr></thead><tbody>${result.stations.map((s) => `<tr><td>${t("station" + s.i)}</td>${["processing", "blocked", "starved", "operator", "repair"].map((k) => `<td>${Math.round(s.time[k] / 60)}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="muted">${t("diagnosisHelp")}</p></section>${events()}`;
}
function events() {
  const map = {
    start: "startEvent",
    delivery: "deliveryEvent",
    failure: "failureEvent",
    repair: "repairEvent",
    quality: "qualityEvent",
    scrap: "scrapEvent",
    ready: "readyEvent",
    shipment: "shipmentEvent",
    shift: "shiftEvent",
    deadline: "deadlineEvent",
  };
  return `<section class="panel"><h2>${t("events")}</h2><p class="muted">${t("lastEvents")}</p><div class="events">${result.log
    .slice(-40)
    .reverse()
    .map(
      (e) =>
        `<div class="event"><time>${clock(e.at)}</time><span>${t(map[e.type])}${/^#\d+/.test(e.message) ? " · " + esc(e.message.match(/^#\d+/)[0]) : ""}</span></div>`,
    )
    .join("")}</div></section>`;
}
function scenarios() {
  return `<h1>${t("scenarios")}</h1><p class="muted">${t("configHelp")}</p><section class="panel"><label class="field">${t("template")}<select id="template">${templates.map((x) => `<option value="${x.key}" ${x.key === templateKey ? "selected" : ""}>${t(x.key)}</option>`).join("")}</select></label></section><div class="grid"><section class="panel"><h2>${scenarioId ? esc(scenarioName) : t("newScenario")}</h2><form id="scenario-form"><div class="form-grid"><label class="field full">${t("scenarioName")}<input id="scenario-name" name="name" value="${esc(scenarioName || t(templateKey))}" minlength="2" maxlength="80" required></label>${[
    ["seed", config.seed, 0, 4294967295],
    ["operators", config.operators, 1, 3],
    ["delivery", config.deliveries[0].at, 0, 604800],
    ["cycle0", config.cycles[0], 30, 3600],
    ["cycle1", config.cycles[1], 30, 3600],
    ["cycle2", config.cycles[2], 30, 3600],
  ]
    .map(
      ([k, n, min, max]) =>
        `<label class="field">${t(k)}<input name="${k}" type="number" value="${n}" min="${min}" max="${max}" step="1" required></label>`,
    )
    .join(
      "",
    )}</div><div class="toolbar"><button class="primary" id="save-scenario">${t("save")}</button><button type="button" id="new-scenario">${t("newScenario")}</button></div></form></section><section class="panel"><h2>${t("myScenarios")}</h2>${saved.length ? saved.map((s) => `<div class="list-item"><span>${esc(s.name)}</span><button data-scenario="${s.id}">${t("load")}</button></div>`).join("") : `<p class="muted">${t("none")}</p>`}</section></div>${controls()}${compare()}`;
}
function resources() {
  if (!result) return "";
  return `<h1>${t("resources")}</h1>${controls()}<section class="panel"><h2>${t("inventory")}</h2><div class="table-wrap"><table><thead><tr>${["component", "stock", "received", "consumed"].map((k) => `<th>${t(k)}</th>`).join("")}</tr></thead><tbody>${Object.keys(
    result.stock,
  )
    .map(
      (k) =>
        `<tr><td>${t(k)}</td><td>${result.stock[k]}</td><td>${result.received[k]}</td><td>${result.started * config.bom[k]}</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><p class="muted">${t("bom")}</p></section><section class="panel"><h2>${t("orders")}</h2><div class="table-wrap"><table><thead><tr>${["order", "due", "shipped", "status"].map((k) => `<th>${t(k)}</th>`).join("")}</tr></thead><tbody>${result.orders.map((o) => `<tr><td>${esc(o.id)}</td><td>${clock(o.due)}</td><td>${o.shipped} / ${o.qty}</td><td>${t(o.completedAt !== null ? (o.completedAt <= o.due ? "completed" : "late") : result.t >= o.due ? "overdue" : "inProgress")}</td></tr>`).join("")}</tbody></table></div><p class="muted">${t("shippingHelp")}</p><p>${t("scrapped")}: ${result.scrapped} · ${t("reworked")}: ${result.reworked}</p></section>`;
}
function profile() {
  return `<h1>${t("profile")}</h1><section class="panel"><form id="profile-form" class="profile-form"><label class="field">${t("name")}<input name="name" value="${esc(me.name)}" minlength="2" maxlength="60" required autocomplete="name"></label><label class="field">${t("email")}<input value="${esc(me.email)}" readonly></label><label class="field">${t("language")}<select name="language">${[
    ["ru", "Русский"],
    ["kk", "Қазақша"],
    ["en", "English"],
  ]
    .map(
      ([k, l]) =>
        `<option value="${k}" ${lang === k ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select></label><label class="field">${t("currentPassword")}<input name="currentPassword" type="password" maxlength="128" autocomplete="current-password"></label><label class="field">${t("newPassword")}<input name="newPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password"></label><p class="muted">${t("profileHelp")}</p><button class="primary">${t("save")}</button></form></section>`;
}
function render() {
  language();
  if (!me) {
    $("shell").innerHTML = authPage();
    $("auth-switch").onclick = () => {
      registering = !registering;
      render();
    };
    $("auth-form").onsubmit = (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      data.language = lang;
      action(async () => {
        const r = await api(registering ? "/auth/register" : "/auth/login", {
          method: "POST",
          data,
        });
        me = r.user;
        csrf = r.csrf;
        lang = me.language;
        await load();
        notify("ready");
      });
    };
    return;
  }
  $("shell").innerHTML =
    `<div class="layout">${nav()}<main id="content" tabindex="-1"><div class="demo">${t("demo")}</div>${{ overview, line, scenarios, resources, profile }[page()]()}<p class="footnote">${t("noRisk")}</p><p class="footnote">${t("local")}</p></main></div>`;
  $("logout").onclick = () =>
    action(async () => {
      await api("/auth/logout", { method: "POST" });
      me = null;
      csrf = "";
      result = null;
      saved = [];
      history = [];
      render();
      notify("logoutDone");
    });
  document.querySelectorAll("[data-calc]").forEach(
    (b) =>
      (b.onclick = () =>
        action(async () => {
          const k = b.dataset.calc;
          notify("calculating");
          await calculate(
            k === "reset"
              ? 0
              : k === "step"
                ? Math.min(config.horizon, (result?.t || 0) + 900)
                : config.horizon,
            k === "save",
          );
          notify(
            k === "save" ? "savedRun" : k === "reset" ? "resetDone" : "ready",
          );
        })),
  );
  document.querySelectorAll("[data-scenario]").forEach(
    (b) =>
      (b.onclick = () =>
        action(async () => {
          const s = saved.find((x) => x.id === Number(b.dataset.scenario));
          scenarioId = s.id;
          scenarioName = s.name;
          config = structuredClone(s.config);
          await calculate(0);
          notify("ready");
        })),
  );
  document.querySelectorAll("[data-run]").forEach(
    (b) =>
      (b.onclick = () =>
        action(async () => {
          const r = await api("/runs/" + b.dataset.run);
          config = r.config;
          scenarioId = null;
          scenarioName = r.name;
          result = r.result.result.snapshot;
          baseResult = r.result.baseline.snapshot;
          elapsed = r.result.result.elapsedMs;
          location.hash = "line";
          render();
          notify("ready");
        })),
  );
  if ($("template"))
    $("template").onchange = () =>
      action(async () => {
        templateKey = $("template").value;
        config = structuredClone(
          templates.find((x) => x.key === templateKey).config,
        );
        scenarioId = null;
        scenarioName = "";
        await calculate(0);
      });
  if ($("new-scenario"))
    $("new-scenario").onclick = () => {
      scenarioId = null;
      scenarioName = "";
      render();
    };
  if ($("scenario-form"))
    $("scenario-form").onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      action(async () => {
        const c = structuredClone(config);
        c.seed = Number(f.seed);
        c.operators = Number(f.operators);
        c.deliveries[0].at = Number(f.delivery);
        c.cycles = [Number(f.cycle0), Number(f.cycle1), Number(f.cycle2)];
        const r = await api(
          "/scenarios" + (scenarioId ? "/" + scenarioId : ""),
          {
            method: scenarioId ? "PUT" : "POST",
            data: { name: f.name, config: c },
          },
        );
        scenarioId = r.id;
        scenarioName = r.name;
        config = r.config;
        saved = (await api("/scenarios")).scenarios;
        await calculate(0);
        notify("saved");
      });
    };
  if ($("profile-form"))
    $("profile-form").onsubmit = (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      action(async () => {
        const r = await api("/me", { method: "PUT", data });
        me = r.user;
        lang = me.language;
        render();
        notify("changed");
      });
    };
}
async function calculate(until, save = false) {
  const r = await api("/simulate", {
    method: "POST",
    data: { ...(scenarioId ? { scenarioId } : { config }), until, save },
  });
  result = r.result.snapshot;
  baseResult = r.baseline.snapshot;
  elapsed = r.result.elapsedMs;
  if (save) history = (await api("/runs")).runs;
  render();
}
async function load() {
  templates = (await api("/templates")).templates;
  saved = (await api("/scenarios")).scenarios;
  history = (await api("/runs")).runs;
  config = structuredClone(templates[0].config);
  templateKey = "base";
  scenarioId = null;
  scenarioName = "";
  await calculate(0);
}
$("language").onchange = () =>
  action(async () => {
    const desired = $("language").value;
    if (me) {
      const r = await api("/me", {
        method: "PUT",
        data: { name: me.name, language: desired },
      });
      me = r.user;
    }
    lang = desired;
    render();
    $("notice").textContent = "";
  });
window.addEventListener("hashchange", () => {
  if (me) {
    render();
    $("content").focus();
  }
});
(async () => {
  try {
    const s = await api("/me");
    me = s.user;
    csrf = s.csrf;
    lang = me.language;
    await load();
  } catch {
    render();
  }
})();
