#!/usr/bin/env node
// Support Slot — live journey, security and concurrency check.
//
// Runs the real marketplace journey against the Supabase TEST project in
// .env.local with SYNTHETIC accounts, through real signed-in sessions that have
// signed in with a password (so the row-level security, the SQL functions and
// the grants are exercised exactly as the app uses them). It sends
// no email (accounts are created with the admin API) and everything it creates
// is removed in `finally`.
//
// What it adds over the in-process Postgres tests (tests/db): REAL parallel
// connections — two artists accepting the same slot at the same instant, five
// simultaneous duplicate applications — which a single-connection test can't
// prove; and the real Auth server's tokens (a session that
// outlives a suspension), which PGlite can't.
//
//   LIVE_CONFIRM_PROJECT_REF=<ref> node scripts/live-journey.mjs
//
// Requires migrations 0001–0007 applied. Exit code 0 only if all checks pass.
// STATUS: written against the new schema but NOT YET RUN — there is no live
// project to run it on (see docs/CURRENT_STATE.md).

import {
  loadEnv, confirmTestProject, adminClient, anonClient, reachAal2, aalOf, rest, accessTokenOf, PLACES,
} from "./lib/live.mjs";

const env = loadEnv();
confirmTestProject(env, "This creates and then deletes synthetic accounts and listings");
const admin = adminClient(env);
const PASSWORD = "CorrectHorse9!Battery-Journey";
const RUN = Math.random().toString(36).slice(2, 8);
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const results = [];
const userIds = [];
const slotIds = [];
const venueIds = [];
const auditTargets = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const errText = (e) => (e ? e.message : "no error");

async function person(role, label, { place = PLACES.london } = {}) {
  const email = `journey-${label}-${RUN}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { role } });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  const id = data.user.id;
  userIds.push(id);
  await admin.from("profiles").update({ has_onboarded: true }).eq("id", id);
  if (role === "artist") {
    const { error: e } = await admin.from("artists").insert({
      id, handle: `journey-${label}-${RUN}`, name: `Journey ${label}`, location: place.label, location_country: place.country,
      location_region: place.region, location_source: "search", genres: ["Indie"], bio: "synthetic journey account used by an automated check",
    });
    if (e) throw new Error(`artist row ${label}: ${e.message}`);
    await admin.from("artist_locations").insert({ artist_id: id, lat: Math.round(place.lat * 100) / 100, lon: Math.round(place.lon * 100) / 100 });
    await admin.from("artist_tracks").insert({ artist_id: id, title: "Track", duration: "3:00" });
  } else {
    const { error: e } = await admin.from("promoters").insert({
      id, name: `Promoter ${label}`, company: `Journey Co ${label}`, location: place.label, location_country: place.country, location_region: place.region, location_source: "search",
    });
    if (e) throw new Error(`promoter row ${label}: ${e.message}`);
  }
  const client = anonClient(env);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw new Error(`sign in ${label}: ${signInError.message}`);
  return { id, client, email };
}

async function main() {
  // --- Who is who ---------------------------------------------------------
  const promoter = await person("promoter", "promoter", { place: PLACES.edinburgh });
  const artistA = await person("artist", "a", { place: PLACES.london });
  const artistB = await person("artist", "b", { place: PLACES.manchester });
  const artistC = await person("artist", "c", { place: PLACES.edinburgh });

  // --- A password-only session is a normal session ---------------------------
  {
    const solo = await person("artist", "solo");
    const token = await accessTokenOf(solo.client);
    const own = await rest(env, token, `profiles?id=eq.${solo.id}&select=id`);
    check("A password-only session reads its own profile", own.status === 200 && Array.isArray(own.body) && own.body.length === 1, `${own.status} ${JSON.stringify(own.body).slice(0, 80)}`);
    const fn = await rest(env, token, "rpc/my_account_status", { method: "POST", body: "{}" });
    check("…and my_account_status answers", fn.status === 200, `${fn.status}`);
    const spoof = await rest(env, token, "applications", { method: "POST", body: JSON.stringify({ slot_id: "00000000-0000-0000-0000-000000000000", artist_id: artistB.id }) });
    check("…but cannot act as someone else", spoof.status >= 400, `${spoof.status}`);
    const pub = await rest(env, null, "slots?select=id&limit=1");
    check("The public (anon) listings are readable without signing in", pub.status === 200);
    const anonProfile = await rest(env, null, "profiles?select=id&limit=1");
    check("…but a visitor cannot read private profile rows", anonProfile.status >= 400 || (Array.isArray(anonProfile.body) && anonProfile.body.length === 0), `${anonProfile.status}`);
  }

  // --- A venue anywhere in the UK, and a listing there ------------------------------------
  const { data: venueId, error: venueError } = await promoter.client.rpc("create_venue", {
    p_name: `Journey Hall ${RUN}`, p_address: "1 Royal Mile, Edinburgh", p_capacity: 300,
    p_label: PLACES.edinburgh.label, p_country: "Scotland", p_region: PLACES.edinburgh.region, p_lat: PLACES.edinburgh.lat, p_lon: PLACES.edinburgh.lon, p_source: "search",
  });
  check("A promoter can add a venue in Scotland (unverified)", !venueError && !!venueId, errText(venueError));
  venueIds.push(venueId);
  {
    const { error } = await artistA.client.rpc("create_venue", { p_name: "No", p_address: "No", p_capacity: 1, p_label: "Elgin, Scotland", p_country: "Scotland", p_region: null, p_lat: 57.65, p_lon: -3.32, p_source: "search" });
    check("An artist can't add a venue", !!error, errText(error));
    const { error: bad } = await promoter.client.rpc("create_venue", { p_name: "Paris Hall", p_address: "Rue 1", p_capacity: 10, p_label: "Paris, England", p_country: "England", p_region: null, p_lat: 48.85, p_lon: 2.35, p_source: "search" });
    check("Coordinates outside the UK are refused", !!bad, errText(bad));
  }

  const { data: slot, error: slotError } = await promoter.client
    .from("slots")
    .insert({
      promoter_id: promoter.id, venue_id: venueId, headliner: `Journey Show ${RUN}`, city: "Spoofed City",
      date: iso(40), doors_time: "19:00", set_time: "20:00", performance_length_mins: 30,
      expected_attendance: 200, support_fee: 120, travel_contribution: 5,
      application_deadline: iso(20), genres: ["Indie"],
    })
    .select("id, city, country, lat")
    .single();
  check("Promoter can publish a valid listing", !!slot && !slotError, errText(slotError));
  if (!slot) return;
  slotIds.push(slot.id);
  check("The listing's place comes from its venue, not from what the client typed", slot.city === PLACES.edinburgh.label && slot.country === "Scotland" && Math.abs(slot.lat - PLACES.edinburgh.lat) < 1e-6, JSON.stringify(slot));

  {
    const { error } = await promoter.client.from("slots").insert({
      promoter_id: promoter.id, venue_id: venueId, headliner: "Past", date: iso(-3), doors_time: "19:00",
      set_time: "20:00", performance_length_mins: 30, expected_attendance: 10, support_fee: 10, application_deadline: iso(-5), genres: ["Indie"],
    });
    check("A listing with a past date is refused by the database", !!error, errText(error));
  }

  // --- Public discovery ---------------------------------------------------
  {
    const anon = anonClient(env);
    const { data, error } = await anon.rpc("search_slots", { p_q: `Journey Show ${RUN}`, p_limit: 5 });
    check("A signed-out visitor can find the listing by search", !error && data?.some((r) => r.id === slot.id), errText(error));
    const near = await anon.rpc("search_slots", { p_q: `Journey Show ${RUN}`, p_near_lat: PLACES.edinburgh.lat, p_near_lon: PLACES.edinburgh.lon, p_max_miles: 10 });
    check("…and by radius around Edinburgh", near.data?.some((r) => r.id === slot.id), errText(near.error));
    const far = await anon.rpc("search_slots", { p_q: `Journey Show ${RUN}`, p_near_lat: PLACES.london.lat, p_near_lon: PLACES.london.lon, p_max_miles: 50 });
    check("…but not within 50 miles of London", !far.data?.some((r) => r.id === slot.id), errText(far.error));
    const { data: art } = await anon.from("artists").select("*").eq("id", artistA.id).single();
    check("A public artist profile exposes no coordinates", art && !Object.keys(art).some((k) => /lat|lon|coord/.test(k)), Object.keys(art ?? {}).join(","));
    const loc = await anon.from("artist_locations").select("*");
    check("A visitor can't read artist_locations at all", !!loc.error, errText(loc.error));
    const other = await artistB.client.from("artist_locations").select("*").eq("artist_id", artistA.id);
    check("Another artist can't read this artist's private coordinates", (other.data?.length ?? 0) === 0, `${other.data?.length ?? 0} rows`);
  }

  // --- Applications ------------------------------------------------------
  const applyAs = (who) =>
    who.client.from("applications").insert({ slot_id: slot.id, artist_id: who.id, message: "hello" }).select("id").single();
  const [a, b] = await Promise.all([applyAs(artistA), applyAs(artistB)]);
  check("Two artists can apply", !!a.data && !!b.data, errText(a.error ?? b.error));
  const appA = a.data?.id;
  const appB = b.data?.id;
  {
    const spoof = await artistA.client.from("applications").insert({ slot_id: slot.id, artist_id: artistC.id });
    check("An artist can't apply as someone else", !!spoof.error, errText(spoof.error));
  }
  {
    const results5 = await Promise.all(Array.from({ length: 5 }, () => applyAs(artistC)));
    const ok = results5.filter((r) => r.data).length;
    check("Five simultaneous duplicate applications create exactly one row", ok === 1, `${ok} succeeded`);
  }
  {
    const { data } = await admin.from("slots").select("applicant_count").eq("id", slot.id).single();
    check("applicant_count matches real applications (3)", data?.applicant_count === 3, `count ${data?.applicant_count}`);
    const { error } = await artistA.client.from("applications").update({ status: "confirmed" }).eq("id", appA);
    const { data: row } = await admin.from("applications").select("status").eq("id", appA).single();
    check("An artist can't confirm their own application", row?.status === "submitted", `status ${row?.status}${error ? ` (${error.message})` : ""}`);
  }

  // --- Viewed / shortlist / terms / offers ---------------------------------------
  {
    const stranger = await artistA.client.rpc("mark_application_viewed", { p_application_id: appB });
    check("Only the owning promoter can record a view", !!stranger.error, errText(stranger.error));
    const { error } = await promoter.client.rpc("mark_application_viewed", { p_application_id: appA });
    const { data } = await admin.from("applications").select("status, viewed_at").eq("id", appA).single();
    check("Opening an application records a genuine 'viewed'", !error && data?.status === "viewed" && !!data.viewed_at, errText(error));
  }
  {
    const { error } = await promoter.client.rpc("shortlist_application", { p_application_id: appB });
    check("Promoter can shortlist", !error, errText(error));
  }
  {
    const t = await promoter.client.rpc("terms_preview", { p_slot_id: slot.id, p_artist_id: artistA.id });
    const row = t.data?.[0];
    check("terms_preview: London → Edinburgh is a long journey, travel lifted from £5 to £10", row?.long_journey === true && row?.travel_pence === 1000 && row?.basis === "straight_line", JSON.stringify(row ?? t.error));
    check("…and the promoter sees the distance rounded to 5 miles", row && row.distance_miles % 5 === 0, `${row?.distance_miles}`);
    const mine = await artistC.client.rpc("terms_preview", { p_slot_id: slot.id });
    check("terms_preview: an Edinburgh artist at an Edinburgh venue is not a long journey (travel stays £5)", mine.data?.[0]?.long_journey === false && mine.data?.[0]?.travel_pence === 500, JSON.stringify(mine.data?.[0] ?? mine.error));
    const nosy = await artistB.client.rpc("terms_preview", { p_slot_id: slot.id, p_artist_id: artistA.id });
    check("One artist can't ask for another's terms", !!nosy.error, errText(nosy.error));
  }

  const offerA = await promoter.client.rpc("make_offer", { p_application_id: appA, p_message: "We'd love you" });
  const offerB = await promoter.client.rpc("make_offer", { p_application_id: appB });
  check("Promoter can offer to two artists (neither is confirmed yet)", !offerA.error && !offerB.error, errText(offerA.error ?? offerB.error));
  {
    const { data: bk } = await admin.from("bookings").select("*").eq("application_id", appA).single();
    check("Stored terms: fee £120.00 and the lifted £10.00 travel, in pence", bk.fee_pence === 12000 && bk.travel_pence === 1000, JSON.stringify({ f: bk.fee_pence, t: bk.travel_pence }));
    check("No money is handled: no fee, total or payment columns on a booking", !("total_pence" in bk) && !("payment_status" in bk) && !("booking_fee_pence" in bk), Object.keys(bk).join(","));
    const dup = await promoter.client.rpc("make_offer", { p_application_id: appA });
    check("A repeated make_offer is refused and creates no second booking", !!dup.error, errText(dup.error));
  }
  {
    const { error } = await promoter.client.rpc("reschedule_slot", { p_slot_id: slot.id, p_date: iso(41), p_doors: "19:00", p_set: "20:00" });
    check("Can't reschedule while an offer is outstanding", !!error, errText(error));
    const { error: editError } = await promoter.client.from("slots").update({ support_fee: 999 }).eq("id", slot.id);
    check("Can't change the fee while an offer is outstanding", !!editError, errText(editError));
  }

  // --- The race: both artists accept at the same instant -------------------
  const [ra, rb] = await Promise.all([
    artistA.client.rpc("respond_to_offer", { p_application_id: appA, p_accept: true }),
    artistB.client.rpc("respond_to_offer", { p_application_id: appB, p_accept: true }),
  ]);
  const winners = [ra, rb].filter((r) => !r.error);
  check("Two simultaneous acceptances: exactly one succeeds", winners.length === 1, `${winners.length} succeeded; errors: ${[ra.error?.message, rb.error?.message].filter(Boolean).join(" | ")}`);
  const { data: confirmed } = await admin.from("bookings").select("id, artist_id, application_id").eq("slot_id", slot.id).eq("status", "confirmed");
  check("Exactly one confirmed booking exists for the slot", confirmed?.length === 1, `${confirmed?.length ?? 0}`);
  const winnerId = confirmed?.[0]?.artist_id;
  const winner = winnerId === artistA.id ? artistA : artistB;
  const winnerApp = winnerId === artistA.id ? appA : appB;
  const loserApp = winnerId === artistA.id ? appB : appA;
  {
    const { data } = await admin.from("slots").select("status").eq("id", slot.id).single();
    check("The slot is now filled", data?.status === "filled", data?.status);
    const { data: lost } = await admin.from("applications").select("status, closed_reason").eq("id", loserApp).single();
    check("The other artist is told it's gone (declined: slot_filled)", lost?.status === "declined" && lost?.closed_reason === "slot_filled", JSON.stringify(lost));
    const again = await winner.client.rpc("respond_to_offer", { p_application_id: winnerApp, p_accept: true });
    check("Accepting again (a retry) is refused and changes nothing", !!again.error, errText(again.error));
    const mine = await winner.client.from("bookings").select("id, status").eq("slot_id", slot.id);
    const theirs = await promoter.client.from("bookings").select("id, status").eq("slot_id", slot.id).eq("status", "confirmed");
    check("Both accounts see the same confirmed booking", mine.data?.some((x) => x.id === confirmed[0].id) && theirs.data?.some((x) => x.id === confirmed[0].id));
  }
  {
    const { error } = await artistC.client.from("applications").insert({ slot_id: slot.id, artist_id: artistC.id });
    check("Nobody can apply to a filled slot", !!error, errText(error));
  }

  // --- Cancellation reopens it ----------------------------------------------
  {
    const { error: noReason } = await winner.client.rpc("cancel_booking", { p_application_id: winnerApp, p_reason: "" });
    check("Cancelling requires a reason", !!noReason, errText(noReason));
    const { error } = await winner.client.rpc("cancel_booking", { p_application_id: winnerApp, p_reason: "Van broke down" });
    check("The artist can cancel with a reason", !error, errText(error));
    const { data } = await admin.from("slots").select("status").eq("id", slot.id).single();
    check("Cancelling puts the slot back on the market", data?.status === "open", data?.status);
  }

  // --- Messaging, blocking ---------------------------------------------------------
  {
    const { data: threadId, error } = await promoter.client.rpc("open_application_thread", { p_application_id: appA });
    check("Promoter can open a conversation for an application", !error && !!threadId, errText(error));
    const clientId = crypto.randomUUID();
    const send = () => promoter.client.from("messages").upsert({ thread_id: threadId, sender_id: promoter.id, text: "Hi there", client_id: clientId }, { onConflict: "sender_id,client_id", ignoreDuplicates: true });
    const first = await send();
    const retry = await send();
    const { data: msgs } = await admin.from("messages").select("id").eq("thread_id", threadId).eq("client_id", clientId);
    check("Sending the same message twice (a retry) stores it once", !first.error && !retry.error && msgs?.length === 1, `${msgs?.length ?? 0} stored; ${errText(first.error ?? retry.error)}`);
    const { error: strangerError } = await artistC.client.from("messages").insert({ thread_id: threadId, sender_id: artistC.id, text: "let me in" });
    check("A stranger can't write into someone else's thread", !!strangerError, errText(strangerError));
    const blockedBy = winner === artistA ? artistB : artistA; // someone with an application and no booking
    const blockApp = blockedBy === artistA ? appA : appB;
    const { error: blockError } = await blockedBy.client.from("promoter_blocks").insert({ artist_id: blockedBy.id, promoter_id: promoter.id });
    check("An artist can block a promoter", !blockError, errText(blockError));
    const { error: afterBlock } = await promoter.client.rpc("open_application_thread", { p_application_id: blockApp });
    check("A blocked promoter can't open a conversation with that artist", !!afterBlock, errText(afterBlock));
    let limited = false;
    for (let i = 0; i < 25 && !limited; i++) {
      const { error: e } = await promoter.client.from("messages").insert({ thread_id: threadId, sender_id: promoter.id, text: `burst ${i}` });
      if (e && /rate_limited|too many|blocked/i.test(e.message)) limited = true;
    }
    check("Message bursts are rate-limited (or refused by the block)", limited);
  }

  // --- Report + staff, suspension of a LIVE session ---------------------------
  {
    const { data: reportId, error } = await artistA.client.rpc("submit_report", {
      p_context_type: "slot", p_context_id: slot.id, p_reported_profile_id: promoter.id, p_reason: "Automated check: this is a synthetic report.",
    });
    check("A user can report a listing", !error && !!reportId, errText(error));
    auditTargets.push(reportId);
    const { error: denied } = await artistA.client.rpc("staff_open_reports", { p_status: "open", p_limit: 5 });
    check("A normal user can't read the moderation queue", !!denied, errText(denied));

    const staff = await person("promoter", "staff");
    await admin.from("profiles").update({ admin_role: "moderator" }).eq("id", staff.id);
    const { data: queue, error: qError } = await staff.client.rpc("staff_open_reports", { p_status: "open", p_limit: 50 });
    check("A moderator can read the queue", !qError && queue?.some((r) => r.id === reportId), errText(qError));
    const { error: payDenied } = await staff.client.rpc("admin_recent_bookings", { p_limit: 5 });
    check("A moderator can't read the bookings list (admin only)", !!payDenied, errText(payDenied));
    const { error: updateError } = await staff.client.rpc("admin_update_report", { p_report_id: reportId, p_status: "dismissed", p_note: "synthetic" });
    check("A moderator can resolve a report", !updateError, errText(updateError));
    const { data: audit } = await admin.from("admin_audit_log").select("action").eq("target_id", reportId);
    check("The action is in the audit log", audit?.some((r) => r.action === "report.dismissed"), JSON.stringify(audit));

    // Suspend artistC while its session is open: the SAME token must stop working.
    await admin.from("profiles").update({ admin_role: "admin" }).eq("id", staff.id);
    const before = await artistC.client.from("profiles").select("id").eq("id", artistC.id);
    const { error: suspendError } = await staff.client.rpc("admin_suspend_user", { p_profile_id: artistC.id, p_reason: "Automated check: synthetic suspension" });
    const after = await artistC.client.from("profiles").select("id").eq("id", artistC.id);
    const status = await artistC.client.rpc("my_account_status");
    const apply = await artistC.client.rpc("withdraw_application", { p_application_id: appA });
    check("Suspending a user stops their already-issued session on the next request", before.data?.length === 1 && !suspendError && (after.data?.length ?? 0) === 0 && !!apply.error,
      `before ${before.data?.length}, after ${after.data?.length}, ${errText(suspendError)}`);
    check("…but it can still see that it is suspended (and why)", status.data?.[0]?.suspended === true, JSON.stringify(status.data ?? status.error));
    await staff.client.rpc("admin_unsuspend_user", { p_profile_id: artistC.id });
    const back = await artistC.client.from("profiles").select("id").eq("id", artistC.id);
    check("Unsuspending restores it", back.data?.length === 1);
    const { data: log } = await admin.from("admin_audit_log").select("action").eq("target_id", artistC.id);
    check("Suspend and unsuspend are both in the audit log", ["user.suspend", "user.unsuspend"].every((x) => log?.some((r) => r.action === x)), JSON.stringify(log));
  }

  // --- Export, then listing lifecycle -----------------------------------------------
  {
    const { data, error } = await artistA.client.rpc("export_my_data");
    const text = JSON.stringify(data ?? {});
    check("A user can export their data", !error && text.includes("Journey a"), errText(error));
    check("The export contains no other user's name and no staff notes", !text.includes("Journey b") && !text.includes("staff_note") && !text.includes("resolution_note") && !text.includes("admin_role"));
  }
  {
    const { error } = await promoter.client.rpc("close_slot", { p_slot_id: slot.id });
    check("Promoter can close applications", !error, errText(error));
    const anon = anonClient(env);
    const { data } = await anon.rpc("search_slots", { p_q: `Journey Show ${RUN}`, p_limit: 5 });
    check("A closed listing disappears from public search", !data?.some((r) => r.id === slot.id), `${data?.length ?? 0} results`);
  }
}

async function cleanup() {
  try {
    if (slotIds.length) await admin.from("bookings").delete().in("slot_id", slotIds);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
    if (venueIds.length) await admin.from("venues").delete().in("id", venueIds.filter(Boolean));
    // Only audit rows about the synthetic accounts and report this run created.
    await admin.from("admin_audit_log").delete().in("target_id", [...userIds, ...auditTargets.filter(Boolean)]);
  } catch (err) {
    console.error("cleanup problem (synthetic rows may remain):", err?.message ?? err);
  }
}

let ok = false;
try {
  await main();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  for (const f of failed) console.log(`  FAILED: ${f.name}`);
  ok = failed.length === 0;
} catch (err) {
  console.error("Journey script crashed:", err);
} finally {
  await cleanup();
}
process.exit(ok ? 0 : 1);
