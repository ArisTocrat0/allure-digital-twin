"use strict";
const { DEFAULT, scenario, validate } = require("../domain/reference.cjs");
function fail(code = "invalid_input") {
  throw Object.assign(Error(code), { status: 400 });
}
const languages = ["ru", "kk", "en"];
function account(v) {
  if (
    typeof v.email !== "string" ||
    !/^\S+@\S+\.\S+$/.test(v.email) ||
    v.email.length > 254
  )
    fail("invalid_email");
  if (
    typeof v.name !== "string" ||
    v.name.trim().length < 2 ||
    v.name.length > 60
  )
    fail("invalid_name");
  if (!languages.includes(v.language)) fail("invalid_language");
  return {
    email: v.email.trim().toLowerCase(),
    name: v.name.trim(),
    language: v.language,
  };
}
function password(p) {
  if (typeof p !== "string" || p.length < 12 || p.length > 128)
    fail("invalid_password");
  return p;
}
// Explicit bounds precede every native conversion. Totals remain safely within int32.
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail("invalid_config");
}
function recordId(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail("invalid_input");
  return value;
}
// JSON can escape lone UTF-16 surrogates that are not valid Unicode scalar values.
// Check keys as well as values, including optional metadata forwarded to the native parser.
function unicodeScalars(input) {
  const pending = [input];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (!value.isWellFormed()) fail("invalid_config");
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (!key.isWellFormed()) fail("invalid_config");
        pending.push(child);
      }
    }
  }
}
function configuration(input) {
  if (!input || typeof input !== "object") fail();
  const c = structuredClone(input);
  try {
    unicodeScalars(c);
    validate(c);
    integer(c.seed, 0, 4294967295);
    integer(c.horizon, 1, 28800);
    integer(c.operators, 1, 3);
    integer(c.shipEvery, 300, 604800);
    if (
      !Array.isArray(c.cycles) ||
      c.cycles.length !== 3 ||
      !Array.isArray(c.bufferCaps) ||
      c.bufferCaps.length !== 2 ||
      !Array.isArray(c.deliveries) ||
      c.deliveries.length > 20 ||
      !Array.isArray(c.failures) ||
      c.failures.length > 20 ||
      !Array.isArray(c.shifts) ||
      c.shifts.length > 10 ||
      !Array.isArray(c.orders) ||
      c.orders.length < 1 ||
      c.orders.length > 20 ||
      Object.keys(c.stock).sort().join() !== "body,engine,wheels" ||
      Object.keys(c.bom).sort().join() !== "body,engine,wheels"
    )
      fail("invalid_config");
    c.cycles.forEach((n) => integer(n, 30, 3600));
    c.bufferCaps.forEach((n) => integer(n, 1, 20));
    Object.values(c.stock).forEach((n) => integer(n, 0, 10000));
    Object.values(c.bom).forEach((n) => integer(n, 1, 100));
    for (const d of c.deliveries) {
      integer(d.at, 0, 604800);
      if (!d.parts || typeof d.parts !== "object" || Array.isArray(d.parts))
        fail("invalid_config");
      for (const [key, n] of Object.entries(d.parts)) {
        if (!Object.hasOwn(c.stock, key)) fail("invalid_config");
        integer(n, 0, 10000);
      }
    }
    for (const f of c.failures) {
      integer(f.at, 0, 604800);
      integer(f.station, 0, 2);
      integer(f.duration, 1, 86400);
    }
    for (const shift of c.shifts) {
      if (!Array.isArray(shift) || shift.length !== 2) fail("invalid_config");
      integer(shift[0], 0, 604800);
      integer(shift[1], 1, 604800);
    }
    for (const o of c.orders) {
      if (typeof o.id !== "string" || o.id.length < 1 || o.id.length > 40)
        fail("invalid_config");
      integer(o.qty, 1, 1000);
      integer(o.due, 0, 604800);
    }
  } catch {
    fail("invalid_config");
  }
  return c;
}
function scenarioInput(v) {
  if (
    typeof v.name !== "string" ||
    v.name.trim().length < 2 ||
    v.name.length > 80
  )
    fail("invalid_name");
  return { name: v.name.trim(), config: configuration(v.config) };
}
module.exports = {
  DEFAULT,
  scenario,
  account,
  password,
  configuration,
  recordId,
  scenarioInput,
  languages,
  fail,
};
