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
function configuration(input) {
  if (!input || typeof input !== "object") fail();
  const c = structuredClone(input);
  try {
    validate(c);
  } catch {
    fail("invalid_config");
  }
  if (
    c.seed > 4294967295 ||
    c.horizon > 28800 ||
    c.cycles.some((v) => v < 30 || v > 3600) ||
    c.shipEvery < 300 ||
    c.bufferCaps.some((v) => v > 20) ||
    c.deliveries.length > 20 ||
    c.failures.length > 20 ||
    c.shifts.length > 10 ||
    c.orders.length > 20 ||
    Object.keys(c.stock).sort().join() !== "body,engine,wheels" ||
    Object.keys(c.bom).sort().join() !== "body,engine,wheels" ||
    Object.values(c.stock).some((v) => v > 10000) ||
    Object.values(c.bom).some((v) => v > 100) ||
    c.deliveries.some(
      (d) => d.at > 604800 || Object.values(d.parts).some((v) => v > 10000),
    ) ||
    c.failures.some((f) => f.at > 604800 || f.duration > 86400) ||
    c.orders.some(
      (o) =>
        typeof o.id !== "string" ||
        o.id.length > 40 ||
        o.qty > 1000 ||
        o.due > 604800,
    ) ||
    c.shifts.some(([a, b]) => b > 604800)
  )
    fail("invalid_config");
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
  scenarioInput,
  languages,
  fail,
};
