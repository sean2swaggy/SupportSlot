#!/usr/bin/env node
// Support Slot — live journey + concurrency check.
//
// Runs the real marketplace journey against the Supabase project in
// .env.local, with SYNTHETIC accounts only, through real signed-in sessions
// (so row-level security and the SQL functions are exercised exactly as the
// app uses them). It does NOT touch Stripe, send email, or call any
// production-only setting. Everything it creates is removed in `finally`.
//
// What it adds over the in-process Postgres tests (tests/db): REAL parallel
// connections — two artists accepting the same slot at the same instant, five
// simultaneous duplicate applications — which a single-connection test can't
// prove.
//
//   node scripts/live-journey.mjs
//
// Requires migrations 0020–0023 to be applied. Exit code 0 only if all pass.

import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`${k} not set in .env.local`);
  return m[1].trim();
};
const URL_ = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "CorrectHorse9!Battery-Journey";
const RUN = Math.random().toString(36).slice(2, 8);

const admin = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const results = [];
const userIds = [];
const slotIds = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const errText = (e) => (e ? e.message : "no error");

async function person(role, label, extra = {}) {
  const email = `journey-${label}-${RUN}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { role },
  });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  const id = data.user.id;
  userIds.push(id);
  await admin.from("profiles").update({ has_onboarded: true }).eq("id", id);
  if (role === "artist") {
    const { error: e } = await admin.from("artists").insert({
      id, handle: `journey-${label}-${RUN}`, name: `Journey ${label}`, location: extra.location ?? "London", genres: ["Indie"],
      bio: "synthetic journey account used by an automated check",
    });
    if (e) throw new Error(`artist row ${label}: ${e.message}`);
    await admin.from("artist_tracks").insert({ artist_id: id, title: "Track", duration: "3:00" });
  } else {
    const { error: e } = await admin.from("promoters").insert({ id, name: `Promoter ${label}`, company: `Journey Co ${label}`, location: "London" });
    if (e) throw new Error(`promoter row ${label}: ${e.message}`);
  }
  const client = createClient(URL_, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw new Error(`sign in ${label}: ${signInError.message}`);
  return { id, client, email };
}

async function main() {
  const { data: venues } = await admin.from("venues").select("id").limit(1);
  if (!venues?.length) throw new Error("No venues in the database.");
  const venueId = venues[0].id;

  const promoter = await person("promoter", "promoter");
  const artistA = await person("artist", "a");
  const artistB = await person("artist", "b");
  const artistC = await person("artist", "c");

  // --- Listing ----------------------------------------------------------
  const { data: slot, error: slotError } = await promoter.client
    .from("slots")
    .insert({
      promoter_id: promoter.id, venue_id: venueId, headliner: `Journey Show ${RUN}`, city: "London",
      date: iso(40), doors_time: "19:00", set_time: "20:00", performance_length_mins: 30,
      expected_attendance: 200, support_fee: 120, travel_contribution: 20, booking_fee: 10,
      application_deadline: iso(20), genres: ["Indie"],
    })
    .select("id")
    .single();
  check("Promoter can publish a valid listing", !!slot && !slotError, errText(slotError));
  if (!slot) return;
  slotIds.push(slot.id);

  {
    const { error } = await promoter.client.from("slots").insert({
      promoter_id: promoter.id, venue_id: venueId, headliner: "Past", city: "London", date: iso(-3), doors_time: "19:00",
      set_time: "20:00", performance_length_mins: 30, expected_attendance: 10, support_fee: 10, application_deadline: iso(-5), genres: ["Indie"],
    });
    check("A listing with a past date is refused by the database", !!error, errText(error));
  }

  // --- Public discovery ---------------------------------------------------
  {
    const anon = createClient(URL_, ANON);
    const { data, error } = await anon.rpc("search_slots", { p_q: `Journey Show ${RUN}`, p_limit: 5 });
    check("A signed-out visitor can find the listing by search", !error && data?.some((r) => r.id === slot.id), errText(error));
  }

  // --- Applications ------------------------------------------------------
  const applyAs = (who) =>
    who.client.from("applications").insert({ slot_id: slot.id, artist_id: who.id, message: "hello" }).select("id").single();
  const [a, b] = await Promise.all([applyAs(artistA), applyAs(artistB)]);
  check("Two artists can apply", !!a.data && !!b.data, errText(a.error ?? b.error));
  const appA = a.data?.id;
  const appB = b.data?.id;

  {
    const results5 = await Promise.all(Array.from({ length: 5 }, () => applyAs(artistC)));
    const ok = results5.filter((r) => r.data).length;
    check("Five simultaneous duplicate applications create exactly one row", ok === 1, `${ok} succeeded`);
  }
  {
    const { data } = await admin.from("slots").select("applicant_count").eq("id", slot.id).single();
    check("applicant_count matches real applications (3)", data?.applicant_count === 3, `count ${data?.applicant_count}`);
  }
  {
    const { error } = await artistA.client.from("applications").update({ status: "confirmed" }).eq("id", appA);
    const { data } = await admin.from("applications").select("status").eq("id", appA).single();
    check("An artist can't confirm their own application", data?.status === "submitted", `status ${data?.status}${error ? ` (${error.message})` : ""}`);
  }

  // --- Viewed / shortlist / offers ---------------------------------------
  {
    const { error } = await promoter.client.rpc("mark_application_viewed", { p_application_id: appA });
    const { data } = await admin.from("applications").select("status, viewed_at").eq("id", appA).single();
    check("Opening an application records a genuine 'viewed'", !error && data?.status === "viewed" && !!data.viewed_at, errText(error));
    const { data: n } = await admin.from("notifications").select("id").eq("profile_id", artistA.id).eq("type", "viewed");
    check("The artist gets a 'viewed' notification", (n?.length ?? 0) === 1, `${n?.length ?? 0}`);
    await promoter.client.rpc("mark_application_viewed", { p_application_id: appA });
    const { data: n2 } = await admin.from("notifications").select("id").eq("profile_id", artistA.id).eq("type", "viewed");
    check("Viewing twice doesn't notify twice", (n2?.length ?? 0) === 1, `${n2?.length ?? 0}`);
  }
  {
    const { error } = await promoter.client.rpc("shortlist_application", { p_application_id: appB });
    check("Promoter can shortlist", !error, errText(error));
  }

  const offerA = await promoter.client.rpc("make_offer", { p_application_id: appA, p_message: "We'd love you" });
  const offerB = await promoter.client.rpc("make_offer", { p_application_id: appB });
  check("Promoter can offer to two artists (neither is confirmed yet)", !offerA.error && !offerB.error, errText(offerA.error ?? offerB.error));

  {
    const { data: bk } = await admin.from("bookings").select("*").eq("application_id", appA).single();
    const base = bk.fee_pence + bk.travel_pence + bk.booking_fee_pence;
    const processing = Math.floor((15 * base + 20 * 1000 + 984) / 985);
    check("Stored terms: fee/travel/booking fee come from the listing", bk.fee_pence === 12000 && bk.travel_pence === 2000 && bk.booking_fee_pence === 1000, JSON.stringify({ f: bk.fee_pence, t: bk.travel_pence, b: bk.booking_fee_pence }));
    check("Stored terms: processing fee and total follow the documented formula", bk.processing_fee_pence === processing && bk.total_pence === base + processing, `processing ${bk.processing_fee_pence}, total ${bk.total_pence}`);
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
    const { data: n } = await admin.from("notifications").select("text").eq("profile_id", promoter.id).eq("type", "booking_cancelled");
    check("The promoter is notified, with the reason", n?.some((x) => x.text.includes("Van broke down")), `${n?.length ?? 0} notifications`);
  }

  // --- Messaging ---------------------------------------------------------
  {
    const { data: threadId, error } = await promoter.client.rpc("open_application_thread", { p_application_id: appA });
    check("Promoter can open a conversation for an application", !error && !!threadId, errText(error));
    const { error: sendError } = await promoter.client.from("messages").insert({ thread_id: threadId, sender_id: promoter.id, text: "Hi there" });
    check("Promoter can send a message", !sendError, errText(sendError));
    const { data: threads } = await artistA.client.from("message_threads").select("id, artist_last_read_at").eq("id", threadId);
    check("The artist can see the thread; it's unread for them", threads?.length === 1 && !threads[0].artist_last_read_at, `${threads?.length ?? 0}`);
    await artistA.client.rpc("mark_thread_read", { p_thread_id: threadId });
    const { data: after } = await artistA.client.from("message_threads").select("artist_last_read_at").eq("id", threadId).single();
    check("Marking a thread read persists", !!after?.artist_last_read_at);
    const { error: strangerError } = await artistC.client.from("messages").insert({ thread_id: threadId, sender_id: artistC.id, text: "let me in" });
    check("A stranger can't write into someone else's thread", !!strangerError, errText(strangerError));
    let limited = false;
    for (let i = 0; i < 25 && !limited; i++) {
      const { error: e } = await promoter.client.from("messages").insert({ thread_id: threadId, sender_id: promoter.id, text: `burst ${i}` });
      if (e && /rate_limited|too many/i.test(e.message)) limited = true;
    }
    check("Message bursts are rate-limited", limited);
  }

  // --- Report + staff ------------------------------------------------------
  {
    const { data: reportId, error } = await artistA.client.rpc("submit_report", {
      p_context_type: "slot", p_context_id: slot.id, p_reported_profile_id: promoter.id, p_reason: "Automated check: this is a synthetic report.",
    });
    check("A user can report a listing", !error && !!reportId, errText(error));
    const { error: denied } = await artistA.client.rpc("staff_open_reports", { p_status: "open", p_limit: 5 });
    check("A normal user can't read the moderation queue", !!denied, errText(denied));

    const staff = await person("promoter", "staff");
    await admin.from("profiles").update({ admin_role: "moderator" }).eq("id", staff.id);
    const { data: queue, error: qError } = await staff.client.rpc("staff_open_reports", { p_status: "open", p_limit: 50 });
    check("A moderator can read the queue", !qError && queue?.some((r) => r.id === reportId), errText(qError));
    const { error: payDenied } = await staff.client.rpc("admin_recent_bookings", { p_limit: 5 });
    check("A moderator can't read payments (admin only)", !!payDenied, errText(payDenied));
    const { error: updateError } = await staff.client.rpc("admin_update_report", { p_report_id: reportId, p_status: "dismissed", p_note: "synthetic" });
    check("A moderator can resolve a report", !updateError, errText(updateError));
    const { data: audit } = await admin.from("admin_audit_log").select("action").eq("target_id", reportId);
    check("The action is in the audit log", audit?.some((r) => r.action === "report.dismissed"), JSON.stringify(audit));
  }

  // --- Listing lifecycle ---------------------------------------------------
  {
    const { error } = await promoter.client.rpc("close_slot", { p_slot_id: slot.id });
    check("Promoter can close applications", !error, errText(error));
    const anon = createClient(URL_, ANON);
    const { data } = await anon.rpc("search_slots", { p_q: `Journey Show ${RUN}`, p_limit: 5 });
    check("A closed listing disappears from public search", !data?.some((r) => r.id === slot.id), `${data?.length ?? 0} results`);
    const { error: lateApply } = await artistC.client.from("applications").insert({ slot_id: slot.id, artist_id: artistC.id });
    check("Nobody can apply to a closed listing", !!lateApply, errText(lateApply));
  }

  // --- Payment functions (service role, fabricated event — no Stripe) --------
  {
    const { data: s2 } = await promoter.client
      .from("slots")
      .insert({
        promoter_id: promoter.id, venue_id: venueId, headliner: `Journey Pay ${RUN}`, city: "London", date: iso(50), doors_time: "19:00",
        set_time: "20:00", performance_length_mins: 30, expected_attendance: 100, support_fee: 100, booking_fee: 10, application_deadline: iso(30), genres: ["Indie"],
      })
      .select("id")
      .single();
    slotIds.push(s2.id);
    const { data: ap } = await artistC.client.from("applications").select("id").eq("slot_id", s2.id);
    const { data: app2 } = await artistB.client.from("applications").insert({ slot_id: s2.id, artist_id: artistB.id }).select("id").single();
    await promoter.client.rpc("make_offer", { p_application_id: app2.id });
    await artistB.client.rpc("respond_to_offer", { p_application_id: app2.id, p_accept: true });
    void ap;
    const { data: bk } = await admin.from("bookings").select("id, total_pence").eq("application_id", app2.id).single();
    const pi = `pi_journey_${RUN}`;
    await admin.rpc("attach_payment_intent", { p_booking_id: bk.id, p_payment_intent_id: pi });
    const args = { p_event_id: `evt_j_${RUN}`, p_occurred: new Date().toISOString(), p_payment_intent_id: pi, p_booking_id: bk.id, p_amount_pence: bk.total_pence, p_charge_id: `ch_j_${RUN}`, p_receipt_url: null };
    const wrong = await admin.rpc("apply_payment_succeeded", { ...args, p_event_id: `evt_bad_${RUN}`, p_amount_pence: bk.total_pence - 1 });
    check("A payment for the wrong amount is refused", !!wrong.error, errText(wrong.error));
    const first = await admin.rpc("apply_payment_succeeded", args);
    const second = await admin.rpc("apply_payment_succeeded", args);
    const { data: after } = await admin.from("bookings").select("payment_status").eq("id", bk.id).single();
    check("A matching payment marks the booking paid", !first.error && after?.payment_status === "paid", errText(first.error));
    check("Replaying the same payment event is harmless", !second.error && after?.payment_status === "paid", errText(second.error));
    const { data: events } = await admin.from("payment_events").select("id").eq("booking_id", bk.id).eq("kind", "payment_succeeded");
    check("...and records exactly one payment_succeeded event", events?.length === 1, `${events?.length ?? 0}`);
  }
}

async function cleanup() {
  try {
    if (slotIds.length) {
      await admin.from("payment_events").delete().in("booking_id", (await admin.from("bookings").select("id").in("slot_id", slotIds)).data?.map((r) => r.id) ?? []);
      await admin.from("bookings").delete().in("slot_id", slotIds);
    }
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
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
