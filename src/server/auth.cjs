"use strict";
const crypto = require("node:crypto"),
  { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$16384$8$1$${salt}$${hash.toString("hex")}`;
}
async function verifyPassword(password, encoded) {
  const [, n, r, p, salt, hex] = encoded.split("$");
  const expected = Buffer.from(hex, "hex"),
    actual = await scrypt(password, salt, 64, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
  return (
    expected.length === actual.length &&
    crypto.timingSafeEqual(expected, actual)
  );
}
const token = () => crypto.randomBytes(32).toString("hex"),
  digest = (x) => crypto.createHash("sha256").update(x).digest("hex");
module.exports = { hashPassword, verifyPassword, token, digest };
