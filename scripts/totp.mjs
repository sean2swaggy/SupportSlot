#!/usr/bin/env node
// Prints the current 6-digit authenticator code for a seeded demo account, so
// you can pass the mandatory 2FA step without a phone.
//
//   node scripts/totp.mjs artist          # demo-artist@example.com
//   node scripts/totp.mjs promoter-plus   # demo-promoter-plus@example.com
//
// Reads .dev-fixtures/accounts.json (gitignored, written by
// seed-dev-fixtures.mjs). Local test accounts only.

import fs from "fs";
import { totp, secondsLeftInWindow } from "./lib/totp.mjs";

const file = new URL("../.dev-fixtures/accounts.json", import.meta.url);
if (!fs.existsSync(file)) {
  console.error("No .dev-fixtures/accounts.json yet — run scripts/seed-dev-fixtures.mjs first.");
  process.exit(1);
}
const accounts = JSON.parse(fs.readFileSync(file, "utf8"));
const loginAccounts = Object.keys(accounts).filter((e) => accounts[e].totpSecret);
const arg = (process.argv[2] ?? "").toLowerCase();
const match = loginAccounts.find((e) => e === arg || e === `demo-${arg}@example.com`);
if (!match) {
  console.error(`Usage: node scripts/totp.mjs <${loginAccounts.map((e) => e.replace(/^demo-|@example\.com$/g, "")).join("|")}>`);
  process.exit(1);
}
console.log(`${match}  ${totp(accounts[match].totpSecret)}  (valid for ~${secondsLeftInWindow()}s)`);
