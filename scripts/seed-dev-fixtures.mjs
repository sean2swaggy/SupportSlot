#!/usr/bin/env node
// Support Slot — fictional demo fixtures for a LOCAL / TEST Supabase project.
//
//   SEED_CONFIRM_PROJECT_REF=<project ref> node scripts/seed-dev-fixtures.mjs
//   SEED_CONFIRM_PROJECT_REF=<project ref> node scripts/seed-dev-fixtures.mjs --reset
//
// - Refuses to run unless you type the project ref.
// - Needs migrations 0001–0005 applied (checks, and stops with a message).
// - Idempotent: everything has a fixed id or is looked up first; re-running
//   adds nothing twice and never overwrites edits you made in the app.
// - Goes through the real SQL functions / RPCs as the real users, so the data
//   is exactly what the app would have produced (offers, bookings, notifications).
// - No email is sent: accounts are created with the admin API (email_confirm), and
//   the example.com addresses are a reserved domain with no mailboxes.
// - Every demo user goes through the REAL second factor (TOTP enrol + verify), so
//   all their calls carry an aal2 token, exactly like the app's. 2FA is not weakened.
// - Passwords and authenticator secrets go to .dev-fixtures/ (gitignored). Never commit them.
// - UK-wide: demo people and venues in England, Scotland, Wales and Northern Ireland,
//   including a small town, a place with no county, three different "Newport"s and a
//   typed-in venue with no map position.

import fs from "fs";
import { PEOPLE, SLOTS, THREADS, SAVED, REPORT, DOMAIN, FIXTURE_VENUES, imageFor } from "./lib/fixture-data.mjs";
import {
  loadEnv, guard, fixtureId, londonDate, readAccounts, writeAccounts, newPassword,
  adminClient, anonClient, must, FIXTURE_DIR, venueFixtureId,
} from "./lib/fixture-helpers.mjs";
import { reachAal2 } from "./lib/live.mjs";
import { totp } from "./lib/totp.mjs";

const env = loadEnv();
const ref = guard(env);
const admin = adminClient(env);
const accounts = readAccounts();
const reset = process.argv.includes("--reset");
const log = (m) => console.log(m);
const byKey = Object.fromEntries(PEOPLE.map((p) => [p.key, p]));
const ids = {}; // person key -> auth user id

// ---------------------------------------------------------------- preflight
async function preflight() {
  const b = await admin.from("bookings").select("id").limit(1);
  const s = await admin.rpc("search_slots", {});
  const l = await admin.from("artist_locations").select("artist_id").limit(1);
  const f = await admin.rpc("terms_preview", { p_slot_id: "00000000-0000-0000-0000-000000000000" });
  if (b.error || l.error || (s.error && /could not find|does not exist|schema cache/i.test(s.error.message)) || (f.error && /could not find|schema cache/i.test(f.error.message))) {
    console.error("The schema isn't fully applied to this project (needs migrations 0001, 0002, 0003, 0004, 0005 in order). See docs/SETUP.md.");
    process.exit(1);
  }
}

// ------------------------------------------------------------------- users
async function findUser(email) {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureUser(p) {
  let user = await findUser(p.email);
  const creds = accounts[p.email] ?? {};
  if (!user) {
    creds.password = creds.password ?? newPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email, password: creds.password, email_confirm: true, user_metadata: { role: p.role },
    });
    if (error) throw new Error(`createUser ${p.email}: ${error.message}`);
    user = data.user;
    log(`  + account ${p.email}`);
  } else {
    if (user.user_metadata?.role && user.user_metadata.role !== p.role) {
      throw new Error(`${p.email} already exists as a ${user.user_metadata.role}, expected ${p.role}. Not touching it.`);
    }
    if (!creds.password) {
      creds.password = newPassword();
      const { error } = await admin.auth.admin.updateUserById(user.id, { password: creds.password });
      if (error) throw new Error(`reset password ${p.email}: ${error.message}`);
      log(`  ~ set a new password for existing ${p.email}`);
    }
  }
  accounts[p.email] = creds;
  writeAccounts(accounts);
  ids[p.key] = user.id;
  return user;
}

const clients = {};
/** A signed-in client for this person, upgraded to aal2 through the real second factor. */
async function as(key) {
  if (clients[key]) return clients[key];
  const p = byKey[key];
  const c = anonClient(env);
  let { error } = await c.auth.signInWithPassword({ email: p.email, password: accounts[p.email].password });
  if (error) {
    // Password was changed outside this script: restore the recorded one.
    await admin.auth.admin.updateUserById(ids[key], { password: accounts[p.email].password });
    ({ error } = await c.auth.signInWithPassword({ email: p.email, password: accounts[p.email].password }));
    if (error) throw new Error(`sign in as ${p.email}: ${error.message}`);
    log(`  ~ restored the recorded password for ${p.email}`);
  }
  const creds = accounts[p.email];
  const { data: fac } = await admin.auth.admin.mfa.listFactors({ userId: ids[key] });
  const verified = (fac?.factors ?? []).some((f) => f.factor_type === "totp" && f.status === "verified");
  if (verified && !creds.totpSecret) {
    // A factor exists but we don't hold its secret: remove it and enrol afresh (fixture accounts only).
    for (const f of fac.factors) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: ids[key] });
  }
  const hadSecret = verified && creds.totpSecret;
  const secret = await reachAal2(c, hadSecret ? creds.totpSecret : undefined);
  if (!hadSecret) { creds.totpSecret = secret; writeAccounts(accounts); log(`  + authenticator enrolled for ${p.email}`); }
  clients[key] = c;
  return c;
}
const rpc = async (key, fn, args) => must(await (await as(key)).rpc(fn, args), `${fn} as ${key}`);

// ---------------------------------------------------------------- profiles
async function ensureProfiles(p) {
  const id = ids[p.key];
  const prof = must(await admin.from("profiles").select("username, admin_role").eq("id", id).single(), "read profile");
  const patch = { has_onboarded: true };
  if (!prof.username) patch.username = p.username;
  if (p.adminRole && !prof.admin_role) patch.admin_role = p.adminRole;
  must(await admin.from("profiles").update(patch).eq("id", id), "update profile");

  if (p.artist) {
    const a = p.artist;
    const imgs = imageFor(p.key);
    must(await admin.from("artists").upsert({
      id, handle: a.handle, name: a.name, location: a.place.label, location_country: a.place.country, location_region: a.place.region,
      location_source: a.typedIn ? "manual" : "search", genres: a.genres, artist_size: a.artist_size,
      travel_radius_miles: a.travel_radius_miles, monthly_listeners: a.monthly_listeners,
      availability: a.availability, last_minute_alerts: a.last_minute_alerts, bio: a.bio,
      image_url: imgs.avatar, banner_image_url: imgs.banner,
      spotify_url: `https://example.com/demo/${a.handle}/spotify`, instagram_url: `https://example.com/demo/${a.handle}/instagram`,
      soundcloud_url: `https://example.com/demo/${a.handle}/soundcloud`, youtube_url: `https://example.com/demo/${a.handle}/youtube`,
      live_video_url: `https://example.com/demo/${a.handle}/live`, live_video_thumbnail_url: imgs.banner,
    }, { onConflict: "id", ignoreDuplicates: true }), `artist ${a.name}`);
    // Private position, rounded to ~1 km exactly as set_my_location stores it.
    must(await admin.from("artist_locations").upsert({ artist_id: id, lat: Math.round(a.place.lat * 100) / 100, lon: Math.round(a.place.lon * 100) / 100 }, { onConflict: "artist_id", ignoreDuplicates: true }), "artist location");
    const t = must(await admin.from("artist_tracks").select("id").eq("artist_id", id).limit(1), "tracks");
    if (t.length === 0) {
      must(await admin.from("artist_tracks").insert(a.tracks.map((x, i) => ({ artist_id: id, title: x.title, duration: x.duration, url: x.url, sort_order: i }))), "insert tracks");
    }
    const sh = must(await admin.from("artist_shows").select("id").eq("artist_id", id).limit(1), "shows");
    if (sh.length === 0 && a.shows.length) {
      must(await admin.from("artist_shows").insert(a.shows.map((x) => ({ artist_id: id, ...x }))), "insert shows");
    }
  }
  if (p.promoter) {
    const imgs = imageFor(p.key);
    const { name, company, place } = p.promoter;
    must(await admin.from("promoters").upsert({
      id, name, company, location: place.label, location_country: place.country, location_region: place.region, location_source: "search", avatar_url: imgs.avatar,
    }, { onConflict: "id", ignoreDuplicates: true }), `promoter ${company}`);
  }
}

// ----------------------------------------------------------------- venues
async function seedVenues() {
  for (const v of FIXTURE_VENUES) {
    const id = venueFixtureId(v.key);
    must(await admin.from("venues").upsert({
      id, name: v.name, city: v.place.label, capacity: v.capacity, address: v.address, verification: "unverified",
      country: v.place.country, region: v.place.region, lat: v.typedIn ? null : v.place.lat, lon: v.typedIn ? null : v.place.lon,
      location_source: v.typedIn ? "manual" : "search", created_by: ids[v.owner],
    }, { onConflict: "id", ignoreDuplicates: true }), `venue ${v.key}`);
  }
}

// ------------------------------------------------------------------ slots
async function seedSlots() {
  const wanted = SLOTS.map((s) => fixtureId("slot", s.n));
  const have = new Set(must(await admin.from("slots").select("id").in("id", wanted), "read slots").map((r) => r.id));
  const tracks = {};
  for (const p of PEOPLE.filter((x) => x.artist)) {
    tracks[p.key] = must(await admin.from("artist_tracks").select("id").eq("artist_id", ids[p.key]).order("sort_order").limit(1), "track").at(0)?.id ?? null;
  }
  for (const s of SLOTS) {
    const slotId = fixtureId("slot", s.n);
    const fresh = !have.has(slotId);
    if (!fresh) log(`  = listing ${s.n} "${s.headliner}" already there`);
    if (fresh) must(await admin.from("slots").insert({
      id: slotId, promoter_id: ids[s.owner], venue_id: s.venue.startsWith("fixture:") ? venueFixtureId(s.venue.slice(8)) : s.venue, headliner: s.headliner,
      headliner_image_url: `https://picsum.photos/seed/ss-demo-show-${s.n}/800/500`,
      date: londonDate(s.days), doors_time: "19:00", set_time: "19:45", performance_length_mins: 30,
      genres: s.genres, expected_attendance: s.attendance, support_fee: s.fee, travel_contribution: s.travel,
      requirements: s.reqs, application_deadline: londonDate(s.deadline),
      is_urgent: !!s.urgent, artist_size_fit: s.sizeFit, description: s.desc,
    }), `insert listing ${s.n}`);
    if (fresh) log(`  + listing ${s.n} "${s.headliner}"`);

    for (const a of s.apps) {
      const appId = fixtureId("app", s.n * 100 + a.n);
      if (must(await admin.from("applications").select("id").eq("id", appId), "app lookup").length > 0) continue;
      must(await (await as(a.artist)).from("applications").insert({
        id: appId, slot_id: slotId, artist_id: ids[a.artist], message: a.msg, featured_track_id: tracks[a.artist],
      }), `apply ${a.artist} -> listing ${s.n}`);
      for (const step of a.steps) {
        const arg = { p_application_id: appId };
        if (step === "view") await rpc(s.owner, "mark_application_viewed", arg);
        else if (step === "shortlist") await rpc(s.owner, "shortlist_application", arg);
        else if (step === "decline") await rpc(s.owner, "decline_application", { ...arg, p_reason: "Not quite the right fit for this bill." });
        else if (step === "offer") await rpc(s.owner, "make_offer", { ...arg, p_message: a.offerMsg ?? null });
        else if (step === "accept") await rpc(a.artist, "respond_to_offer", { ...arg, p_accept: true, p_reason: null });
        else if (step === "declineOffer") await rpc(a.artist, "respond_to_offer", { ...arg, p_accept: false, p_reason: a.declineReason ?? null });
        else if (step === "withdraw") await rpc(a.artist, "withdraw_application", arg);
        else throw new Error(`unknown step ${step}`);
      }
    }
    if (!fresh) continue;
    if (s.finalize === "close") await rpc(s.owner, "close_slot", { p_slot_id: slotId });
    if (s.finalize === "cancel") await rpc(s.owner, "cancel_slot", { p_slot_id: slotId, p_reason: s.cancelReason ?? null });
  }
}

// ------------------------------------------------------ conversations etc.
async function seedThreads() {
  for (const t of THREADS) {
    const slot = SLOTS.find((s) => s.n === t.slot);
    const app = slot.apps.find((a) => a.n === t.app);
    const appId = fixtureId("app", t.slot * 100 + t.app);
    const exists = must(await admin.from("applications").select("id").eq("id", appId), "app lookup");
    if (exists.length === 0) continue;
    const who = { promoter: slot.owner, artist: app.artist };
    const threadId = await rpc(who[t.starter], "open_application_thread", { p_application_id: appId });
    const n = must(await admin.from("messages").select("id", { count: "exact", head: false }).eq("thread_id", threadId).limit(1), "msgs");
    if (n.length > 0) continue;
    for (const [from, text] of t.messages) {
      must(await (await as(who[from])).from("messages").insert({ thread_id: threadId, sender_id: ids[who[from]], text }), "send message");
    }
    if (t.read === "both") {
      await rpc(who.promoter, "mark_thread_read", { p_thread_id: threadId });
      await rpc(who.artist, "mark_thread_read", { p_thread_id: threadId });
    }
    log(`  + conversation on listing ${t.slot} (${t.messages.length} messages)`);
  }
}

async function seedSavedAndReport() {
  for (const s of SAVED) {
    for (const n of s.slots) {
      must(await (await as(s.who)).from("saved_slots").upsert(
        { profile_id: ids[s.who], slot_id: fixtureId("slot", n) }, { onConflict: "profile_id,slot_id", ignoreDuplicates: true }), "save gig");
    }
  }
  const have = must(await admin.from("reports").select("id").eq("reporter_id", ids[REPORT.by]).eq("context_id", fixtureId("slot", REPORT.slot)), "reports");
  if (have.length === 0) {
    await rpc(REPORT.by, "submit_report", {
      p_context_type: "slot", p_context_id: fixtureId("slot", REPORT.slot),
      p_reported_profile_id: ids[REPORT.against], p_reason: REPORT.reason,
    });
    log("  + one report for the admin queue");
  }
}

function writeSummary() {
  const rows = PEOPLE.filter((p) => p.login).map((p) => {
    const label = p.key === "artist1" ? "Artist" : p.key === "artist2" ? "Second artist" : p.key === "promA" ? "Promoter (free)" : p.key === "promB" ? "Second promoter" : "Admin";
    return `| ${label} | ${p.email} | ${accounts[p.email].password} | \`node scripts/totp.mjs ${p.email.replace(/^demo-|@.*$/g, "")}\` |`;
  });
  const md = `# Demo logins (fictional, local/test only — do not commit)\n\nProject: ${ref}\n\n| Role | Email | Password | 2FA code |\n|---|---|---|---|\n${rows.join("\n")}\n\nAfter the password, the app asks for a 6-digit code: run the command in the last column.\nThese accounts use ${DOMAIN} addresses (a reserved domain with no mailboxes) and were created without sending any email.\n`;
  fs.writeFileSync(new URL("TEST_ACCOUNTS.md", FIXTURE_DIR), md, { mode: 0o600 });
}

// ------------------------------------------------------------------- reset
async function doReset() {
  log("Resetting fixture rows only…");
  const slotIds = SLOTS.map((s) => fixtureId("slot", s.n));
  const promIds = [];
  const allIds = [];
  for (const p of PEOPLE) {
    const u = await findUser(p.email);
    if (u) { allIds.push(u.id); if (p.role === "promoter") promIds.push(u.id); }
  }
  must(await admin.from("bookings").delete().in("slot_id", slotIds), "delete bookings");
  if (allIds.length) must(await admin.from("reports").delete().in("reporter_id", allIds), "delete reports");
  must(await admin.from("slots").delete().in("id", slotIds), "delete listings");
  must(await admin.from("venues").delete().in("id", FIXTURE_VENUES.map((v) => venueFixtureId(v.key))), "delete fixture venues");
  for (const id of allIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) log(`  ! could not delete a demo account: ${error.message}`);
  }
  fs.rmSync(new URL("accounts.json", FIXTURE_DIR), { force: true });
  log("Done. Re-run without --reset to recreate.");
}

// -------------------------------------------------------------------- main
try {
  log(`Target project: ${ref} (confirmed). Fictional data only.`);
  await preflight();
  if (reset) { await doReset(); process.exit(0); }
  log("Accounts and profiles");
  for (const p of PEOPLE) { await ensureUser(p); await ensureProfiles(p); }
  log("Venues (UK-wide), listings, applications, offers, bookings");
  await seedVenues();
  await seedSlots();
  log("Conversations, saved gigs, report");
  await seedThreads();
  await seedSavedAndReport();
  log("Authenticators (every person who logs in has one; others get one the first time they act)");
  for (const p of PEOPLE.filter((x) => x.login)) await as(p.key);
  writeSummary();
  log("\nDone. Logins are in .dev-fixtures/TEST_ACCOUNTS.md (gitignored). 2FA code: node scripts/totp.mjs artist");
} catch (err) {
  console.error("\nSeed failed:", err.message);
  console.error("Safe to re-run: it skips anything already created. (--reset removes fixture rows.)");
  process.exit(1);
}
