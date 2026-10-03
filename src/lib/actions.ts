// Every write the signed-in UI makes. Anything that changes application,
// booking, listing or message state goes through a SQL function (see
// supabase/migrations/0021_booking_functions.sql), which checks who's asking
// and what state things are in, inside one transaction. Each function
// returns a Result — callers must look at it; nothing here ever pretends a
// failed write succeeded.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type Result } from "./result";

async function rpc<T = unknown>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Result<T>> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return fail(error);
    return ok(data as T);
  } catch (err) {
    return fail(err);
  }
}

// --- Applications ---------------------------------------------------------

export async function applyToSlot(
  supabase: SupabaseClient,
  input: { slotId: string; artistId: string; featuredTrackId?: string; message?: string }
): Promise<Result<{ id: string }>> {
  try {
    const { data, error } = await supabase
      .from("applications")
      .insert({
        slot_id: input.slotId,
        artist_id: input.artistId,
        featured_track_id: input.featuredTrackId || null,
        message: input.message?.trim() || null,
      })
      .select("id")
      .single();
    if (error || !data) return fail(error ?? "Couldn't submit your application.");
    return ok({ id: data.id as string });
  } catch (err) {
    return fail(err);
  }
}

export const markApplicationViewed = (s: SupabaseClient, applicationId: string) =>
  rpc<void>(s, "mark_application_viewed", { p_application_id: applicationId });
export const shortlistApplication = (s: SupabaseClient, applicationId: string) =>
  rpc<void>(s, "shortlist_application", { p_application_id: applicationId });
export const declineApplication = (s: SupabaseClient, applicationId: string, reason?: string) =>
  rpc<void>(s, "decline_application", { p_application_id: applicationId, p_reason: reason ?? null });
export const makeOffer = (s: SupabaseClient, applicationId: string, message?: string) =>
  rpc<string>(s, "make_offer", { p_application_id: applicationId, p_message: message ?? null });
export const withdrawOffer = (s: SupabaseClient, applicationId: string) =>
  rpc<void>(s, "withdraw_offer", { p_application_id: applicationId });
export const respondToOffer = (s: SupabaseClient, applicationId: string, accept: boolean, reason?: string) =>
  rpc<"confirmed" | "declined">(s, "respond_to_offer", { p_application_id: applicationId, p_accept: accept, p_reason: reason ?? null });
export const withdrawApplication = (s: SupabaseClient, applicationId: string) =>
  rpc<void>(s, "withdraw_application", { p_application_id: applicationId });
export const cancelBooking = (s: SupabaseClient, applicationId: string, reason: string) =>
  rpc<void>(s, "cancel_booking", { p_application_id: applicationId, p_reason: reason });

// --- Listings ------------------------------------------------------------

export const closeSlot = (s: SupabaseClient, slotId: string) => rpc<void>(s, "close_slot", { p_slot_id: slotId });
export const cancelSlot = (s: SupabaseClient, slotId: string, reason?: string) =>
  rpc<void>(s, "cancel_slot", { p_slot_id: slotId, p_reason: reason ?? null });
export const rescheduleSlot = (s: SupabaseClient, slotId: string, date: string, doorsTime: string, setTime: string) =>
  rpc<void>(s, "reschedule_slot", { p_slot_id: slotId, p_date: date, p_doors: doorsTime, p_set: setTime });

export async function reopenSlot(supabase: SupabaseClient, slotId: string): Promise<Result<void>> {
  const { data, error } = await supabase.from("slots").update({ status: "open", closed_at: null, closed_reason: null }).eq("id", slotId).select("id");
  if (error) return fail(error);
  if (!data || data.length === 0) return fail("You can't reopen this listing.");
  return ok();
}

// --- Messaging -----------------------------------------------------------

export const openApplicationThread = (s: SupabaseClient, applicationId: string) =>
  rpc<string>(s, "open_application_thread", { p_application_id: applicationId });
export const markThreadRead = (s: SupabaseClient, threadId: string) =>
  rpc<void>(s, "mark_thread_read", { p_thread_id: threadId });

export async function sendMessageRow(
  supabase: SupabaseClient,
  input: { threadId: string; senderId: string; text: string }
): Promise<Result<{ id: string; createdAt: string }>> {
  try {
    const { data, error } = await supabase
      .from("messages")
      .insert({ thread_id: input.threadId, sender_id: input.senderId, text: input.text })
      .select("id, created_at")
      .single();
    if (error || !data) return fail(error ?? "Couldn't send that message.");
    return ok({ id: data.id as string, createdAt: data.created_at as string });
  } catch (err) {
    return fail(err);
  }
}

// --- Saved gigs -----------------------------------------------------------

export async function getSavedSlotIds(supabase: SupabaseClient, profileId: string): Promise<string[]> {
  const { data } = await supabase.from("saved_slots").select("slot_id").eq("profile_id", profileId);
  return (data ?? []).map((r: { slot_id: string }) => r.slot_id);
}

export async function saveSlot(supabase: SupabaseClient, profileId: string, slotId: string): Promise<Result<void>> {
  const { error } = await supabase.from("saved_slots").insert({ profile_id: profileId, slot_id: slotId });
  // Saving something already saved is a success, not an error.
  if (error && !/duplicate|unique/i.test(error.message)) return fail(error);
  return ok();
}

export async function unsaveSlot(supabase: SupabaseClient, profileId: string, slotId: string): Promise<Result<void>> {
  const { error } = await supabase.from("saved_slots").delete().eq("profile_id", profileId).eq("slot_id", slotId);
  if (error) return fail(error);
  return ok();
}

// --- Reports / blocking ------------------------------------------------------

export type ReportContext = "availability_request" | "message" | "slot" | "profile" | "application" | "booking" | "other";

export const submitReport = (
  s: SupabaseClient,
  input: { contextType: ReportContext; contextId?: string; reportedProfileId?: string; reason: string }
) =>
  rpc<string>(s, "submit_report", {
    p_context_type: input.contextType,
    p_context_id: input.contextId ?? null,
    p_reported_profile_id: input.reportedProfileId ?? null,
    p_reason: input.reason,
  });

// --- Profile --------------------------------------------------------------

export interface ArtistProfilePatch {
  name?: string;
  location?: string;
  genres?: string[];
  bio?: string;
  availability?: "available" | "limited" | "unavailable";
  travel_radius_miles?: number;
  live_video_url?: string | null;
  last_minute_alerts?: boolean;
}

export async function updateArtistProfile(supabase: SupabaseClient, artistId: string, patch: ArtistProfilePatch): Promise<Result<void>> {
  const { data, error } = await supabase.from("artists").update(patch).eq("id", artistId).select("id");
  if (error) return fail(error);
  if (!data || data.length === 0) return fail("Your profile couldn't be saved.");
  return ok();
}

export interface TrackInput {
  title: string;
  duration: string;
  url: string | null;
}

export async function addTrack(supabase: SupabaseClient, artistId: string, track: TrackInput, sortOrder: number): Promise<Result<{ id: string }>> {
  const { data, error } = await supabase
    .from("artist_tracks")
    .insert({ artist_id: artistId, title: track.title.trim(), duration: track.duration.trim(), url: track.url, sort_order: sortOrder })
    .select("id")
    .single();
  if (error || !data) return fail(error ?? "Couldn't add that track.");
  return ok({ id: data.id as string });
}

export async function updateTrack(supabase: SupabaseClient, artistId: string, trackId: string, track: TrackInput): Promise<Result<void>> {
  const { data, error } = await supabase
    .from("artist_tracks")
    .update({ title: track.title.trim(), duration: track.duration.trim(), url: track.url })
    .eq("id", trackId)
    .eq("artist_id", artistId)
    .select("id");
  if (error) return fail(error);
  if (!data || data.length === 0) return fail("Couldn't save that track.");
  return ok();
}

export async function deleteTrack(supabase: SupabaseClient, artistId: string, trackId: string): Promise<Result<void>> {
  const { error } = await supabase.from("artist_tracks").delete().eq("id", trackId).eq("artist_id", artistId);
  if (error) return fail(error);
  return ok();
}

export async function setEmailNotifications(supabase: SupabaseClient, profileId: string, enabled: boolean): Promise<Result<void>> {
  const { data, error } = await supabase.from("profiles").update({ email_notifications: enabled }).eq("id", profileId).select("id");
  if (error) return fail(error);
  if (!data || data.length === 0) return fail("Couldn't save that setting.");
  return ok();
}

// --- Listing edit ---------------------------------------------------------

export interface ListingPatch {
  headliner: string;
  headlinerImage: string | null;
  artistPhoto: string | null;
  venueId: string;
  city: string;
  date: string;
  doorsTime: string;
  setTime: string;
  performanceLengthMins: number;
  genres: string[];
  expectedAttendance: number;
  supportFee: number;
  travelContribution: number;
  bookingFee: number;
  requirements: string[];
  applicationDeadline: string;
  isUrgent: boolean;
  artistSizeFit: string[];
  description: string;
}

/**
 * Edits a listing the signed-in promoter owns. RLS limits the row to the
 * owner; slots_guard() refuses a change to the date, venue, times or money
 * while an offer or confirmed booking exists, and notifies applicants of
 * material changes otherwise.
 */
export async function updateListing(supabase: SupabaseClient, slotId: string, p: ListingPatch): Promise<Result<void>> {
  const { data, error } = await supabase
    .from("slots")
    .update({
      headliner: p.headliner,
      headliner_image_url: p.headlinerImage,
      artist_photo_url: p.artistPhoto,
      venue_id: p.venueId,
      city: p.city,
      date: p.date,
      doors_time: p.doorsTime,
      set_time: p.setTime,
      performance_length_mins: p.performanceLengthMins,
      genres: p.genres,
      expected_attendance: p.expectedAttendance,
      support_fee: p.supportFee,
      travel_contribution: p.travelContribution,
      booking_fee: p.bookingFee,
      requirements: p.requirements,
      application_deadline: p.applicationDeadline,
      is_urgent: p.isUrgent,
      artist_size_fit: p.artistSizeFit,
      description: p.description,
    })
    .eq("id", slotId)
    .select("id");
  if (error) return fail(error);
  // Zero rows means the policy hid it from this user: not theirs, or gone.
  if (!data || data.length === 0) return fail("You can't edit this listing.");
  return ok();
}
