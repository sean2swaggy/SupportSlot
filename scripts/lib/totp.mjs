// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — just enough to enrol and verify the
// authenticator factor for local demo accounts. Shared by seed-dev-fixtures.mjs
// and totp.mjs. Not used by the app itself.

import crypto from "crypto";

export function base32Decode(s) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase().replace(/\s/g, "")) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error("Invalid base32 secret");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secretB32, at = Date.now()) {
  const counter = Math.floor(at / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secretB32)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

export const secondsLeftInWindow = (at = Date.now()) => 30 - (Math.floor(at / 1000) % 30);
