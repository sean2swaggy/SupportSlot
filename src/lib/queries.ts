// Async replacements for the old src/lib/mock-data.ts getters, now backed by
// Supabase. Every function takes a SupabaseClient so it works from both the
// server client (Server Components) and the browser client (store.tsx) —
// see src/lib/supabase/server.ts and src/lib/supabase/client.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  toApplication,
  toArtist,
  toAvailabilityRequestForArtist,
  toAvailabilityRequestWithRecipients,
  toEventTemplate,
  toGigInvitationForArtist,
  toGigInvitationForPromoter,
  toMessageThread,
  toNotification,
  toPromoter,
  toRosterEntry,
  toScheduleEntry,
  toScheduleTemplate,
  toShowSchedule,
  toSlot,
  toVenue,
  type ArtistRow,
  type ArtistShowRow,
  type ArtistTrackRow,
  type AvailabilityRequestRecipientRow,
  type AvailabilityRequestRow,
  type EventTemplateRow,
  type GigInvitationRow,
  type MessageRow,
  type MessageThreadRow,
  type PromoterRow,
  type RosterRow,
  type ScheduleEntryRow,
  type ScheduleTemplateEntryRow,
  type ScheduleTemplateRow,
  type ShowScheduleRow,
  type SlotRow,
  type VenueRow,
} from "@/lib/supabase/mappers";
import type {
  Application,
  Artist,
  AvailabilityRequestForArtist,
  AvailabilityRequestWithRecipients,
  Currency,
  EventTemplate,
  GigInvitationForArtist,
  GigInvitationForPromoter,
  MessageThread,
  NotificationItem,
  Promoter,
  RosterEntry,
  ScheduleEntry,
  ScheduleTemplate,
  ScheduleTemplateEntry,
  ShowSchedule,
  SupportSlot,
  Venue,
} from "@/lib/types";
import { effectiveTravelContribution } from "@/lib/travel";
import { londonToday } from "@/lib/dates";
import { toBooking, toPaymentEvent, BOOKING_COLUMNS, type BookingRow, type PaymentEventRow } from "@/lib/supabase/mappers";
import type { Booking, PaymentEvent } from "@/lib/types";
import { validateRecipients } from "@/lib/availability";

export const ARTIST_COLUMNS =
  "id, handle, name, image_url, banner_image_url, location, genres, spotify_url, instagram_url, tiktok_url, soundcloud_url, bandcamp_url, youtube_url, website_url, monthly_listeners, bio, live_video_thumbnail_url, live_video_url, availability, travel_radius_miles, verification, artist_size, last_minute_alerts, stripe_transfers_active, member_since";

async function fetchArtistWithChildren(
  supabase: SupabaseClient,
  filter: { column: "id" | "handle"; value: string }
): Promise<Artist | null> {
  const { data: artistRow, error } = await supabase
    .from("artists")
    .select(ARTIST_COLUMNS)
    .eq(filter.column, filter.value)
    .maybeSingle();
  if (error || !artistRow) return null;

  const row = artistRow as ArtistRow;
  const [{ data: tracks }, { data: shows }] = await Promise.all([
    supabase
      .from("artist_tracks")
      .select("id, title, duration, cover_image_url, url, sort_order")
      .eq("artist_id", row.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("artist_shows")
      .select("id, kind, headliner, venue, city, date")
      .eq("artist_id", row.id)
      .order("date", { ascending: false }),
  ]);

  return toArtist(row, (tracks as ArtistTrackRow[]) ?? [], (shows as ArtistShowRow[]) ?? []);
}

export function getArtist(supabase: SupabaseClient, id: string) {
  return fetchArtistWithChildren(supabase, { column: "id", value: id });
}

export function getArtistByHandle(supabase: SupabaseClient, handle: string) {
  return fetchArtistWithChildren(supabase, { column: "handle", value: handle });
}

export async function getPromoter(supabase: SupabaseClient, id: string): Promise<Promoter | null> {
  const { data, error } = await supabase
    .from("promoters")
    .select("id, name, company, avatar_url, location, verification, shows_posted")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return toPromoter(data as PromoterRow);
}

export async function getFeaturedArtists(supabase: SupabaseClient, limit = 8): Promise<Artist[]> {
  const { data, error } = await supabase
    .from("artists")
    .select(ARTIST_COLUMNS)
    .order("member_since", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as ArtistRow[]).map((row) => toArtist(row));
}

// Every artist on the platform, for the promoter-facing Discover Artists
// browser (src/components/discovery/PromoterDiscoverArtists.tsx) — same
// "fetch everything once, filter client-side" shape the slot discovery
// page already uses, so search/genre/location/distance can all be instant.
export async function getAllArtists(supabase: SupabaseClient): Promise<Artist[]> {
  const { data, error } = await supabase
    .from("artists")
    .select(ARTIST_COLUMNS)
    .order("member_since", { ascending: false });
  if (error || !data) return [];
  return (data as ArtistRow[]).map((row) => toArtist(row));
}

export async function getVenues(supabase: SupabaseClient): Promise<Venue[]> {
  const { data, error } = await supabase.from("venues").select("*").order("name");
  if (error || !data) return [];
  return (data as VenueRow[]).map(toVenue);
}

export async function getVenue(supabase: SupabaseClient, id: string): Promise<Venue | null> {
  const { data, error } = await supabase.from("venues").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return toVenue(data as VenueRow);
}

export const SLOT_COLUMNS =
  "id, promoter_id, venue_id, headliner, headliner_image_url, artist_photo_url, city, date, doors_time, set_time, performance_length_mins, genres, expected_attendance, support_fee, travel_contribution, booking_fee, requirements, application_deadline, applicant_count, is_urgent, status, artist_size_fit, description, rescheduled_at, posted_at";

// Includes the venue so a list of cards doesn't need a request per card.
export const SLOT_WITH_VENUE_COLUMNS = `${SLOT_COLUMNS}, venues(id, name, city, capacity, address, image_url, verification)`;

export async function getSlot(supabase: SupabaseClient, id: string): Promise<SupportSlot | null> {
  const { data, error } = await supabase.from("slots").select(SLOT_WITH_VENUE_COLUMNS).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return toSlot(data as unknown as SlotRow);
}

// "Active" = open AND neither the application deadline nor the show date has
// passed in UK time. Matches search_slots() in 0020_marketplace_core.sql.
export async function getOpenSlots(supabase: SupabaseClient): Promise<SupportSlot[]> {
  const today = londonToday();
  const { data, error } = await supabase
    .from("slots")
    .select(SLOT_WITH_VENUE_COLUMNS)
    .eq("status", "open")
    .gte("application_deadline", today)
    .gte("date", today)
    .order("date", { ascending: true });
  if (error || !data) return [];
  return (data as unknown as SlotRow[]).map(toSlot);
}

export async function getUrgentSlots(supabase: SupabaseClient): Promise<SupportSlot[]> {
  const today = londonToday();
  const { data, error } = await supabase
    .from("slots")
    .select(SLOT_WITH_VENUE_COLUMNS)
    .eq("status", "open")
    .eq("is_urgent", true)
    .gte("application_deadline", today)
    .gte("date", today)
    .order("application_deadline", { ascending: true });
  if (error || !data) return [];
  return (data as unknown as SlotRow[]).map(toSlot);
}

export interface SlotSearchParams {
  q?: string;
  city?: string;
  genre?: string;
  from?: string;
  to?: string;
  minFee?: number;
  venueSize?: "intimate" | "mid" | "large";
  artistSize?: "emerging" | "developing" | "established";
  fromCity?: string;
  maxMiles?: number;
  urgentOnly?: boolean;
  sort?: "date" | "fee" | "newest";
  page?: number;
  pageSize?: number;
}

export interface SlotSearchResult {
  slots: SupportSlot[];
  total: number;
  page: number;
  pageSize: number;
}

// Public discovery: one server-side query (search_slots) does the searching,
// filtering, sorting and paging, so it's correct for anonymous visitors and
// doesn't download every listing. Errors are returned, not swallowed — the
// page shows "couldn't load" with a retry instead of a misleading empty list.
export async function searchSlots(
  supabase: SupabaseClient,
  params: SlotSearchParams
): Promise<{ ok: true; data: SlotSearchResult } | { ok: false; error: string }> {
  const pageSize = Math.min(Math.max(params.pageSize ?? 12, 1), 50);
  const page = Math.max(params.page ?? 1, 1);
  const { data: hits, error } = await supabase.rpc("search_slots", {
    p_q: params.q?.trim() || null,
    p_city: params.city || null,
    p_genre: params.genre || null,
    p_from: params.from || null,
    p_to: params.to || null,
    p_min_fee: params.minFee ?? null,
    p_venue_size: params.venueSize ?? null,
    p_artist_size: params.artistSize ?? null,
    p_from_city: params.fromCity ?? null,
    p_max_miles: params.maxMiles ?? null,
    p_urgent_only: params.urgentOnly ?? false,
    p_sort: params.sort ?? "date",
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) return { ok: false, error: "We couldn't load listings just now. Please try again." };
  const ids = (hits as Array<{ id: string; total_count: number | string }> | null) ?? [];
  const total = ids.length ? Number(ids[0].total_count) : 0;
  if (ids.length === 0) return { ok: true, data: { slots: [], total, page, pageSize } };

  const { data: rows, error: rowsError } = await supabase
    .from("slots")
    .select(SLOT_WITH_VENUE_COLUMNS)
    .in("id", ids.map((h) => h.id));
  if (rowsError || !rows) return { ok: false, error: "We couldn't load listings just now. Please try again." };
  const byId = new Map((rows as unknown as SlotRow[]).map((r) => [r.id, toSlot(r)]));
  // The RPC decides the order; keep it.
  const slots = ids.map((h) => byId.get(h.id)).filter((x): x is SupportSlot => !!x);
  return { ok: true, data: { slots, total, page, pageSize } };
}

export async function getSlotsForPromoter(supabase: SupabaseClient, promoterId: string): Promise<SupportSlot[]> {
  const { data, error } = await supabase
    .from("slots")
    .select(SLOT_COLUMNS)
    .eq("promoter_id", promoterId)
    .order("posted_at", { ascending: false });
  if (error || !data) return [];
  return (data as SlotRow[]).map(toSlot);
}

export const APPLICATION_COLUMNS =
  "id, slot_id, artist_id, status, featured_track_id, message, submitted_at, status_changed_at, viewed_at, closed_reason";

export async function getApplicationsForSlot(supabase: SupabaseClient, slotId: string): Promise<Application[]> {
  const { data, error } = await supabase
    .from("applications")
    .select(APPLICATION_COLUMNS)
    .eq("slot_id", slotId)
    .order("submitted_at", { ascending: false });
  if (error || !data) return [];
  return data.map(toApplication);
}

export async function getApplicationsForArtist(supabase: SupabaseClient, artistId: string): Promise<Application[]> {
  const { data, error } = await supabase
    .from("applications")
    .select(APPLICATION_COLUMNS)
    .eq("artist_id", artistId)
    .order("submitted_at", { ascending: false });
  if (error || !data) return [];
  return data.map(toApplication);
}

// Every application a promoter's own slots have received, joined in one
// query — avoids the old N+1 "look up each applicant's artist row"
// pattern that ApplicantManagementClient used against mock-data.
export async function getApplicationsForPromoterSlots(
  supabase: SupabaseClient,
  promoterId: string
): Promise<Array<Application & { artist: Artist }>> {
  const { data: slotRows } = await supabase.from("slots").select("id").eq("promoter_id", promoterId);
  const slotIds = (slotRows ?? []).map((s: { id: string }) => s.id);
  if (slotIds.length === 0) return [];

  const { data, error } = await supabase
    .from("applications")
    .select(`${APPLICATION_COLUMNS}, artists(${ARTIST_COLUMNS})`)
    .in("slot_id", slotIds)
    .order("submitted_at", { ascending: false });
  if (error || !data) return [];

  return data
    .filter((row) => row.artists)
    .map((row) => ({
      ...toApplication(row),
      artist: toArtist(row.artists as unknown as ArtistRow),
    }));
}

export async function getNotifications(supabase: SupabaseClient, profileId: string): Promise<NotificationItem[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, text, href, read, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data.map(toNotification);
}

// An artist's bookings, with real payment state. "Received" only counts
// bookings Stripe has confirmed as paid (and not wholly refunded); what the
// artist receives is the agreed fee plus travel — Support Slot's booking fee
// and the card-processing line are never taken from it. Stripe then pays the
// artist out to their bank on its own schedule (see PayoutPanel).
export async function getArtistBookings(
  supabase: SupabaseClient,
  artistId: string
): Promise<{ ok: true; data: Booking[] } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("artist_id", artistId)
    .order("event_date", { ascending: false });
  if (error) return { ok: false, error: "We couldn't load your bookings. Please try again." };
  return { ok: true, data: (data as unknown as BookingRow[]).map(toBooking) };
}

export function summariseArtistEarnings(bookings: Booking[]): { receivedPence: number; awaitingPaymentPence: number } {
  let received = 0;
  let awaiting = 0;
  for (const b of bookings) {
    const artistShare = b.feePence + b.travelPence;
    if (b.status === "confirmed") {
      if (b.paymentStatus === "paid" || b.paymentStatus === "partially_refunded") {
        received += artistShare;
      } else if (b.paymentStatus === "unpaid" || b.paymentStatus === "processing" || b.paymentStatus === "failed") {
        awaiting += artistShare;
      }
    }
  }
  return { receivedPence: received, awaitingPaymentPence: awaiting };
}

export async function getPromoterBookings(
  supabase: SupabaseClient,
  promoterId: string
): Promise<{ ok: true; data: Booking[] } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("promoter_id", promoterId)
    .order("event_date", { ascending: false });
  if (error) return { ok: false, error: "We couldn't load your bookings. Please try again." };
  return { ok: true, data: (data as unknown as BookingRow[]).map(toBooking) };
}

export async function getBookingsForSlot(supabase: SupabaseClient, slotId: string): Promise<Booking[]> {
  const { data, error } = await supabase.from("bookings").select(BOOKING_COLUMNS).eq("slot_id", slotId);
  if (error || !data) return [];
  return (data as unknown as BookingRow[]).map(toBooking);
}

export async function getPaymentEvents(supabase: SupabaseClient, bookingId: string): Promise<PaymentEvent[]> {
  const { data, error } = await supabase
    .from("payment_events")
    .select("id, kind, amount_pence, occurred_at")
    .eq("booking_id", bookingId)
    .order("occurred_at", { ascending: true });
  if (error || !data) return [];
  return (data as PaymentEventRow[]).map(toPaymentEvent);
}

// Message threads for one side of a conversation (artist or promoter),
// mapped from that viewer's perspective. To keep this fast it loads the most
// recent messages across the viewer's threads (not every message ever sent);
// older history is fetched per conversation with loadEarlierMessages().
export const MESSAGES_PER_PAGE = 30;

export async function getMessageThreads(
  supabase: SupabaseClient,
  viewer: { role: "artist" | "promoter"; id: string }
): Promise<MessageThread[]> {
  const column = viewer.role === "artist" ? "artist_id" : "promoter_id";
  const { data: threadRows, error } = await supabase
    .from("message_threads")
    .select(
      `id, application_id, context, artist_last_read_at, promoter_last_read_at, last_message_at, created_at,
       artists(id, name, image_url), promoters(id, company, avatar_url)`
    )
    .eq(column, viewer.id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);
  if (error || !threadRows) return [];

  const threadIds = threadRows.map((t) => t.id);
  const { data: messageRows } = threadIds.length
    ? await supabase
        .from("messages")
        .select("id, thread_id, sender_id, text, created_at")
        .in("thread_id", threadIds)
        .order("created_at", { ascending: false })
        .limit(400)
    : { data: [] as MessageRow[] };

  return threadRows.map((t) => {
    const artist = (t as unknown as { artists: { id: string; name: string; image_url: string | null } | null }).artists;
    const promoter = (t as unknown as { promoters: { id: string; company: string; avatar_url: string | null } | null })
      .promoters;
    const withName = viewer.role === "artist" ? promoter?.company ?? "" : artist?.name ?? "";
    const withImage = viewer.role === "artist" ? promoter?.avatar_url ?? "" : artist?.image_url ?? "";
    const messages = ((messageRows as MessageRow[] | null)?.filter((m) => m.thread_id === t.id) ?? []).slice(0, MESSAGES_PER_PAGE);

    return toMessageThread(t as unknown as MessageThreadRow, messages, {
      viewerRole: viewer.role,
      viewerId: viewer.id,
      withId: (viewer.role === "artist" ? promoter?.id : artist?.id) ?? "",
      withName,
      withImage,
    });
  });
}

// One page of older messages for a conversation (oldest-first for display).
export async function loadEarlierMessages(
  supabase: SupabaseClient,
  threadId: string,
  before: string,
  viewerId: string
): Promise<Array<{ id: string; from: "me" | "them"; text: string; time: string }>> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, sender_id, text, created_at")
    .eq("thread_id", threadId)
    .lt("created_at", before)
    .order("created_at", { ascending: false })
    .limit(MESSAGES_PER_PAGE);
  if (error || !data) return [];
  return data
    .map((m) => ({ id: m.id as string, from: (m.sender_id === viewerId ? "me" : "them") as "me" | "them", text: m.text as string, time: m.created_at as string }))
    .reverse();
}

// ---------------------------------------------------------------------------
// Artist Roster — Support+ only (enforced server-side by RLS, see
// 0010_promoter_support_plus.sql). Read/delete stay available regardless of
// current subscription status; only insert/update require is_support_plus.
// ---------------------------------------------------------------------------

const ROSTER_COLUMNS = `id, notes, tags, added_at, artists(${ARTIST_COLUMNS})`;

export async function getRoster(supabase: SupabaseClient, promoterId: string): Promise<RosterEntry[]> {
  const { data, error } = await supabase
    .from("artist_roster")
    .select(ROSTER_COLUMNS)
    .eq("promoter_id", promoterId)
    .order("added_at", { ascending: false });
  if (error || !data) return [];
  return (data as unknown as RosterRow[]).map((row) => toRosterEntry(row));
}

// Cheap lookup for "is this artist already saved" state on cards across the
// site, without pulling every roster row's full artist join.
export async function getRosterArtistIds(supabase: SupabaseClient, promoterId: string): Promise<Set<string>> {
  const { data } = await supabase.from("artist_roster").select("artist_id").eq("promoter_id", promoterId);
  return new Set((data ?? []).map((r) => r.artist_id as string));
}

export async function addToRoster(
  supabase: SupabaseClient,
  promoterId: string,
  artistId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("artist_roster")
    .insert({ promoter_id: promoterId, artist_id: artistId });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Already on your roster." };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function removeFromRoster(supabase: SupabaseClient, rosterEntryId: string): Promise<boolean> {
  const { error } = await supabase.from("artist_roster").delete().eq("id", rosterEntryId);
  return !error;
}

export async function updateRosterEntry(
  supabase: SupabaseClient,
  rosterEntryId: string,
  updates: { notes?: string; tags?: string[] }
): Promise<boolean> {
  const { error } = await supabase
    .from("artist_roster")
    .update({ ...(updates.notes !== undefined && { notes: updates.notes }), ...(updates.tags && { tags: updates.tags }) })
    .eq("id", rosterEntryId);
  return !error;
}

// A promoter's own booking history with one artist — reuses `applications`
// directly rather than a separate ledger, so it can never drift from what
// actually happened.
export async function getBookingHistoryWithArtist(
  supabase: SupabaseClient,
  promoterId: string,
  artistId: string
): Promise<Array<Application & { slot: SupportSlot }>> {
  const { data: slotRows } = await supabase.from("slots").select("id").eq("promoter_id", promoterId);
  const slotIds = (slotRows ?? []).map((s: { id: string }) => s.id);
  if (slotIds.length === 0) return [];
  const { data, error } = await supabase
    .from("applications")
    .select(`${APPLICATION_COLUMNS}, slots(${SLOT_COLUMNS})`)
    .eq("artist_id", artistId)
    .in("slot_id", slotIds)
    .order("submitted_at", { ascending: false });
  if (error || !data) return [];
  return data
    .filter((row) => row.slots)
    .map((row) => ({ ...toApplication(row), slot: toSlot(row.slots as unknown as SlotRow) }));
}

// ---------------------------------------------------------------------------
// Event templates
// ---------------------------------------------------------------------------

export async function getEventTemplates(supabase: SupabaseClient, promoterId: string): Promise<EventTemplate[]> {
  const { data, error } = await supabase
    .from("event_templates")
    .select("id, name, event_name, venue_name, venue_location, proposed_fee, currency, set_length_mins, message")
    .eq("promoter_id", promoterId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as EventTemplateRow[]).map(toEventTemplate);
}

export async function createEventTemplate(
  supabase: SupabaseClient,
  promoterId: string,
  template: Omit<EventTemplate, "id">
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("event_templates").insert({
    promoter_id: promoterId,
    name: template.name,
    event_name: template.eventName,
    venue_name: template.venueName,
    venue_location: template.venueLocation,
    proposed_fee: template.proposedFee,
    currency: template.currency,
    set_length_mins: template.setLengthMins,
    message: template.message,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteEventTemplate(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("event_templates").delete().eq("id", id);
  return !error;
}

// ---------------------------------------------------------------------------
// Availability requests
// ---------------------------------------------------------------------------

export async function createAvailabilityRequest(
  supabase: SupabaseClient,
  promoterId: string,
  input: {
    eventName: string;
    eventDate: string;
    eventTime: string;
    timezone: string;
    venueName: string;
    venueLocation: string;
    proposedFee: number;
    currency: Currency;
    setLengthMins: number;
    responseDeadline: string;
    message?: string;
    artistIds: string[];
  }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const recipientCheck = validateRecipients(input.artistIds);
  if (!recipientCheck.ok) return recipientCheck;

  const { data: request, error: requestError } = await supabase
    .from("availability_requests")
    .insert({
      promoter_id: promoterId,
      event_name: input.eventName,
      event_date: input.eventDate,
      event_time: input.eventTime,
      timezone: input.timezone,
      venue_name: input.venueName,
      venue_location: input.venueLocation,
      proposed_fee: input.proposedFee,
      currency: input.currency,
      set_length_mins: input.setLengthMins,
      response_deadline: input.responseDeadline,
      message: input.message || null,
    })
    .select("id")
    .single();
  if (requestError || !request) {
    return { ok: false, error: requestError?.message ?? "Couldn't create the request." };
  }

  const { error: recipientsError } = await supabase.from("availability_request_recipients").insert(
    input.artistIds.map((artistId) => ({ request_id: request.id, artist_id: artistId }))
  );
  if (recipientsError) {
    // Best-effort cleanup so a partially-failed send doesn't leave an empty
    // request with no recipients behind.
    await supabase.from("availability_requests").delete().eq("id", request.id);
    return { ok: false, error: recipientsError.message };
  }

  return { ok: true, id: request.id };
}

export async function getAvailabilityRequestsForPromoter(
  supabase: SupabaseClient,
  promoterId: string
): Promise<AvailabilityRequestWithRecipients[]> {
  const { data, error } = await supabase
    .from("availability_requests")
    .select(
      `id, promoter_id, event_name, event_date, event_time, timezone, venue_name, venue_location, proposed_fee, currency, set_length_mins, response_deadline, message, status, linked_slot_id, created_at,
       availability_request_recipients(id, request_id, artist_id, response, responded_at, question_asked, thread_id, linked_application_id, artists(${ARTIST_COLUMNS}), applications(status))`
    )
    .eq("promoter_id", promoterId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map((row) =>
    toAvailabilityRequestWithRecipients(
      row as unknown as AvailabilityRequestRow,
      (row as unknown as { availability_request_recipients: Array<AvailabilityRequestRecipientRow & { artists: ArtistRow }> })
        .availability_request_recipients
    )
  );
}

export async function withdrawAvailabilityRequest(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("availability_requests").update({ status: "withdrawn" }).eq("id", id);
  return !error;
}

export async function markAvailabilityRequestFilled(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("availability_requests").update({ status: "filled" }).eq("id", id);
  return !error;
}

// Turns an "available" response into a real booking, reusing the existing
// apply/book flow end to end — never a separate payment path. Returns the
// full application either way (creates it, or returns the existing one if
// this artist/slot pair was already applied/booked) — the promoter's own
// `applications` list in the store won't have this row yet (it wasn't
// created through addApplication), so the caller needs the real object
// back directly rather than looking it up in stale local state.
export async function getAvailabilityRequestsForArtist(
  supabase: SupabaseClient,
  artistId: string
): Promise<AvailabilityRequestForArtist[]> {
  const { data, error } = await supabase
    .from("availability_request_recipients")
    .select(
      `id, request_id, artist_id, response, responded_at, question_asked, thread_id, linked_application_id,
       availability_requests(id, promoter_id, event_name, event_date, event_time, timezone, venue_name, venue_location, proposed_fee, currency, set_length_mins, response_deadline, message, status, linked_slot_id, created_at, promoters(company, avatar_url))`
    )
    .eq("artist_id", artistId);
  if (error || !data) return [];
  return data
    .filter((row) => row.availability_requests)
    .map((row) => {
      const req = row.availability_requests as unknown as AvailabilityRequestRow & {
        promoters: { company: string; avatar_url: string | null } | null;
      };
      return toAvailabilityRequestForArtist(req, row as unknown as AvailabilityRequestRecipientRow, {
        company: req.promoters?.company ?? "A promoter",
        avatar_url: req.promoters?.avatar_url ?? null,
      });
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function respondToAvailabilityRequest(
  supabase: SupabaseClient,
  recipientId: string,
  response: "available" | "unavailable"
): Promise<boolean> {
  const { error } = await supabase
    .from("availability_request_recipients")
    .update({ response, responded_at: new Date().toISOString() })
    .eq("id", recipientId);
  return !error;
}

// "Ask a question" reuses the existing thread-based messaging system rather
// than inventing a parallel Q&A mechanism — finds or creates the thread for
// this specific request, marks question_asked (which never changes
// `response`), and returns the thread id to navigate to.
export async function startAvailabilityRequestQuestion(
  supabase: SupabaseClient,
  input: { recipientId: string; artistId: string; promoterId: string; requestId: string }
): Promise<{ ok: true; threadId: string } | { ok: false; error: string }> {
  const context = `availability-request:${input.requestId}`;
  const { data: existingThread } = await supabase
    .from("message_threads")
    .select("id")
    .eq("artist_id", input.artistId)
    .eq("promoter_id", input.promoterId)
    .eq("context", context)
    .maybeSingle();

  let threadId = existingThread?.id as string | undefined;
  if (!threadId) {
    const { data: created, error } = await supabase
      .from("message_threads")
      .insert({ artist_id: input.artistId, promoter_id: input.promoterId, context })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: error?.message ?? "Couldn't start a conversation." };
    threadId = created.id;
  }

  await supabase
    .from("availability_request_recipients")
    .update({ question_asked: true, thread_id: threadId })
    .eq("id", input.recipientId);

  return { ok: true, threadId: threadId! };
}

// ---------------------------------------------------------------------------
// Block / report — availability requests only, see 0011_availability_requests.sql.
// ---------------------------------------------------------------------------

export async function blockPromoter(supabase: SupabaseClient, artistId: string, promoterId: string): Promise<boolean> {
  const { error } = await supabase.from("promoter_blocks").insert({ artist_id: artistId, promoter_id: promoterId });
  return !error;
}

export async function unblockPromoter(supabase: SupabaseClient, artistId: string, promoterId: string): Promise<boolean> {
  const { error } = await supabase
    .from("promoter_blocks")
    .delete()
    .eq("artist_id", artistId)
    .eq("promoter_id", promoterId);
  return !error;
}

export async function getBlockedPromoters(
  supabase: SupabaseClient,
  artistId: string
): Promise<Array<{ promoterId: string; company: string }>> {
  const { data, error } = await supabase
    .from("promoter_blocks")
    .select("promoter_id, promoters(company)")
    .eq("artist_id", artistId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    promoterId: r.promoter_id as string,
    company: (r as unknown as { promoters: { company: string } | null }).promoters?.company ?? "A promoter",
  }));
}

export async function getSlotsByIds(supabase: SupabaseClient, ids: string[]): Promise<SupportSlot[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("slots").select(SLOT_WITH_VENUE_COLUMNS).in("id", ids);
  if (error) throw new Error(error.message);
  return (data as unknown as SlotRow[]).map(toSlot);
}

export async function isPromoterBlocked(supabase: SupabaseClient, artistId: string, promoterId: string): Promise<boolean> {
  const { data } = await supabase
    .from("promoter_blocks")
    .select("id")
    .eq("artist_id", artistId)
    .eq("promoter_id", promoterId)
    .maybeSingle();
  return !!data;
}

// ---------------------------------------------------------------------------
// Gig invitations — the "Invite to gig" action on Discover Artists. Free
// for every promoter (no Support+ gate, unlike availability requests). See
// 0015_gig_invitations.sql.
// ---------------------------------------------------------------------------

export const GIG_INVITATION_COLUMNS =
  "id, slot_id, promoter_id, artist_id, message, status, linked_application_id, created_at, responded_at";

export async function createGigInvitation(
  supabase: SupabaseClient,
  input: { slotId: string; promoterId: string; artistId: string; message?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("gig_invitations").insert({
    slot_id: input.slotId,
    promoter_id: input.promoterId,
    artist_id: input.artistId,
    message: input.message || null,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "You've already invited this artist to this gig." };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// Which of a promoter's own artists (roster or otherwise) already have a
// pending/accepted invitation to a given slot — drives the "already
// invited" state on the discovery card without waiting for a failed insert.
export async function getInvitedArtistIdsForSlot(supabase: SupabaseClient, slotId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("gig_invitations")
    .select("artist_id")
    .eq("slot_id", slotId)
    .in("status", ["pending", "accepted"]);
  return new Set((data ?? []).map((r) => r.artist_id as string));
}

export async function getInvitationsForArtist(
  supabase: SupabaseClient,
  artistId: string
): Promise<GigInvitationForArtist[]> {
  const { data, error } = await supabase
    .from("gig_invitations")
    .select(`${GIG_INVITATION_COLUMNS}, slots(${SLOT_COLUMNS}), promoters(company)`)
    .eq("artist_id", artistId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data
    .filter((row) => row.slots)
    .map((row) =>
      toGigInvitationForArtist(
        row as unknown as GigInvitationRow,
        row.slots as unknown as SlotRow,
        (row.promoters as unknown as { company: string } | null) ?? { company: "A promoter" }
      )
    );
}

export async function getInvitationsForPromoterSlots(
  supabase: SupabaseClient,
  promoterId: string
): Promise<GigInvitationForPromoter[]> {
  const { data, error } = await supabase
    .from("gig_invitations")
    .select(`${GIG_INVITATION_COLUMNS}, artists(${ARTIST_COLUMNS})`)
    .eq("promoter_id", promoterId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data
    .filter((row) => row.artists)
    .map((row) => toGigInvitationForPromoter(row as unknown as GigInvitationRow, row.artists as unknown as ArtistRow));
}

// Accept creates a real application, exactly as if the artist had applied
// themselves (artist_id = auth.uid(), same insert policy, no RLS carve-out
// needed) — everything downstream (shortlist, book, pay) is the existing,
// unchanged flow. Decline just records the response; neither ever books
// anything.
export async function respondToGigInvitation(
  supabase: SupabaseClient,
  input: { invitationId: string; response: "accepted" | "declined"; artist: Artist; slot: SupportSlot }
): Promise<{ ok: true } | { ok: false; error: string }> {
  let linkedApplicationId: string | undefined;

  if (input.response === "accepted") {
    const { data: existing } = await supabase
      .from("applications")
      .select("id")
      .eq("slot_id", input.slot.id)
      .eq("artist_id", input.artist.id)
      .maybeSingle();

    if (existing) {
      linkedApplicationId = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from("applications")
        .insert({
          slot_id: input.slot.id,
          artist_id: input.artist.id,
          status: "submitted",
          message: "Applied via promoter invitation.",
        })
        .select("id")
        .single();
      if (error || !created) return { ok: false, error: error?.message ?? "Couldn't submit your application." };
      linkedApplicationId = created.id;
    }
  }

  const { error } = await supabase
    .from("gig_invitations")
    .update({
      status: input.response,
      responded_at: new Date().toISOString(),
      ...(linkedApplicationId && { linked_application_id: linkedApplicationId }),
    })
    .eq("id", input.invitationId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function withdrawGigInvitation(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("gig_invitations").update({ status: "withdrawn" }).eq("id", id);
  return !error;
}

// ---------------------------------------------------------------------------
// Show Schedule — Support+ only, promoter-owned, never artist-facing. Every
// table here (0016_show_schedules.sql) is RLS-gated by promoter_is_subscribed()
// on every operation including select, so a lapsed subscription or an
// unowned slot simply yields null/empty results here — that's the "block
// viewing without deleting data" requirement enforced at the database, not
// just by these functions. Callers should still gate the page itself on
// useStore().isSupportPlus so a free promoter sees an upgrade prompt instead
// of a bare empty state.
// ---------------------------------------------------------------------------

export const SCHEDULE_ENTRY_COLUMNS =
  "id, schedule_id, kind, title, stage, start_at, end_at, artist_id, notes, sort_order";

export async function getShowSchedule(supabase: SupabaseClient, slotId: string): Promise<ShowSchedule | null> {
  const { data: scheduleRow, error } = await supabase
    .from("show_schedules")
    .select("id, slot_id, promoter_id, status, version, updated_at")
    .eq("slot_id", slotId)
    .maybeSingle();
  if (error || !scheduleRow) return null;
  const { data: entryRows } = await supabase
    .from("schedule_entries")
    .select(SCHEDULE_ENTRY_COLUMNS)
    .eq("schedule_id", (scheduleRow as ShowScheduleRow).id);
  return toShowSchedule(scheduleRow as ShowScheduleRow, (entryRows as ScheduleEntryRow[]) ?? []);
}

async function createShowSchedule(
  supabase: SupabaseClient,
  slotId: string,
  promoterId: string
): Promise<ShowSchedule | null> {
  const { data, error } = await supabase
    .from("show_schedules")
    .insert({ slot_id: slotId, promoter_id: promoterId })
    .select("id, slot_id, promoter_id, status, version, updated_at")
    .single();
  if (error || !data) return null;
  return toShowSchedule(data as ShowScheduleRow, []);
}

// First visit to a slot's schedule — reuses the existing row if the
// promoter already started one, otherwise creates an empty draft. Ownership
// (the slot must be this promoter's own) is enforced by the insert policy's
// `exists (... s.promoter_id = auth.uid())` check, not duplicated here.
//
// The select-then-insert here isn't atomic, so two near-simultaneous first
// visits (two tabs, or React StrictMode's dev-only double-effect) can both
// see "no row yet" and both attempt the insert — `slot_id` is unique, so the
// loser gets a 23505 conflict. That's expected, not a real failure: it means
// someone else's insert just won the race, so fall back to re-reading the
// row it created instead of surfacing an error.
export async function getOrCreateShowSchedule(
  supabase: SupabaseClient,
  slotId: string,
  promoterId: string
): Promise<ShowSchedule | null> {
  const existing = await getShowSchedule(supabase, slotId);
  if (existing) return existing;
  const created = await createShowSchedule(supabase, slotId, promoterId);
  if (created) return created;
  return getShowSchedule(supabase, slotId);
}

type ScheduleClaim = { ok: true; version: number } | { ok: false; error: "stale" | "support_plus_required" | string };

// Every mutation below "claims" the next version first via the atomic
// compare-and-swap RPC (see claim_schedule_version() in the migration).
// Losing the race — someone else's edit landed first — surfaces as
// error: "stale" so the UI can prompt a reload instead of silently
// overwriting the other edit.
async function claimScheduleVersion(
  supabase: SupabaseClient,
  scheduleId: string,
  expectedVersion: number
): Promise<ScheduleClaim> {
  const { data, error } = await supabase.rpc("claim_schedule_version", {
    p_schedule_id: scheduleId,
    p_expected_version: expectedVersion,
  });
  if (error) {
    if (error.message.includes("stale_schedule_version")) return { ok: false, error: "stale" };
    if (error.message.includes("support_plus_required")) return { ok: false, error: "support_plus_required" };
    return { ok: false, error: error.message };
  }
  return { ok: true, version: data as number };
}

export async function addScheduleEntry(
  supabase: SupabaseClient,
  scheduleId: string,
  expectedVersion: number,
  entry: Omit<ScheduleEntry, "id" | "scheduleId">
): Promise<{ ok: true; version: number; entry: ScheduleEntry } | { ok: false; error: string }> {
  const claim = await claimScheduleVersion(supabase, scheduleId, expectedVersion);
  if (!claim.ok) return { ok: false, error: claim.error };
  const { data, error } = await supabase
    .from("schedule_entries")
    .insert({
      schedule_id: scheduleId,
      kind: entry.kind,
      title: entry.title,
      stage: entry.stage,
      start_at: entry.start,
      end_at: entry.end,
      artist_id: entry.artistId ?? null,
      notes: entry.notes,
      sort_order: entry.sortOrder,
    })
    .select(SCHEDULE_ENTRY_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't add that entry." };
  return { ok: true, version: claim.version, entry: toScheduleEntry(data as ScheduleEntryRow) };
}

export async function updateScheduleEntry(
  supabase: SupabaseClient,
  scheduleId: string,
  expectedVersion: number,
  entryId: string,
  updates: Partial<Omit<ScheduleEntry, "id" | "scheduleId">>
): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const claim = await claimScheduleVersion(supabase, scheduleId, expectedVersion);
  if (!claim.ok) return { ok: false, error: claim.error };
  const patch: Record<string, unknown> = {};
  if (updates.kind !== undefined) patch.kind = updates.kind;
  if (updates.title !== undefined) patch.title = updates.title;
  if (updates.stage !== undefined) patch.stage = updates.stage;
  if (updates.start !== undefined) patch.start_at = updates.start;
  if (updates.end !== undefined) patch.end_at = updates.end;
  if (updates.artistId !== undefined) patch.artist_id = updates.artistId ?? null;
  if (updates.notes !== undefined) patch.notes = updates.notes;
  if (updates.sortOrder !== undefined) patch.sort_order = updates.sortOrder;
  const { error } = await supabase.from("schedule_entries").update(patch).eq("id", entryId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, version: claim.version };
}

export async function deleteScheduleEntry(
  supabase: SupabaseClient,
  scheduleId: string,
  expectedVersion: number,
  entryId: string
): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const claim = await claimScheduleVersion(supabase, scheduleId, expectedVersion);
  if (!claim.ok) return { ok: false, error: claim.error };
  const { error } = await supabase.from("schedule_entries").delete().eq("id", entryId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, version: claim.version };
}

// Applies the {id, sortOrder} pairs produced by reorderWithinStage /
// drag-and-drop (see lib/schedule.ts) — only ever writes sort_order, never
// start_at/end_at, so reordering can never silently change an entry's time.
export async function reorderScheduleEntries(
  supabase: SupabaseClient,
  scheduleId: string,
  expectedVersion: number,
  pairs: Array<{ id: string; sortOrder: number }>
): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const claim = await claimScheduleVersion(supabase, scheduleId, expectedVersion);
  if (!claim.ok) return { ok: false, error: claim.error };
  const results = await Promise.all(
    pairs.map((p) => supabase.from("schedule_entries").update({ sort_order: p.sortOrder }).eq("id", p.id))
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };
  return { ok: true, version: claim.version };
}

// "Final" is an internal planning label only — this never notifies an
// artist or touches applications/booking status in any way.
export async function setScheduleStatus(
  supabase: SupabaseClient,
  scheduleId: string,
  expectedVersion: number,
  status: "draft" | "final"
): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const claim = await claimScheduleVersion(supabase, scheduleId, expectedVersion);
  if (!claim.ok) return { ok: false, error: claim.error };
  const { error } = await supabase.from("show_schedules").update({ status }).eq("id", scheduleId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, version: claim.version };
}

// Booked (confirmed) artists for this slot — the only source the "assigned
// artist" dropdown and the "Unscheduled artists" panel are allowed to pick
// from. Reflects real applications rows only; never invents availability.
export async function getConfirmedArtistsForSlot(supabase: SupabaseClient, slotId: string): Promise<Artist[]> {
  const { data, error } = await supabase
    .from("applications")
    .select(`artist_id, artists(${ARTIST_COLUMNS})`)
    .eq("slot_id", slotId)
    .eq("status", "booked");
  if (error || !data) return [];
  return data.filter((row) => row.artists).map((row) => toArtist(row.artists as unknown as ArtistRow));
}

// Artist ids whose booking for this slot was cancelled — lets the UI flag
// any schedule entries still assigned to them for review, without ever
// deleting or silently changing the entry itself.
export async function getCancelledArtistIdsForSlot(supabase: SupabaseClient, slotId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("applications")
    .select("artist_id")
    .eq("slot_id", slotId)
    .eq("status", "cancelled");
  return new Set((data ?? []).map((r) => r.artist_id as string));
}

// ---------------------------------------------------------------------------
// Schedule templates
// ---------------------------------------------------------------------------

export async function getScheduleTemplates(
  supabase: SupabaseClient,
  promoterId: string
): Promise<ScheduleTemplate[]> {
  const { data: templateRows, error } = await supabase
    .from("schedule_templates")
    .select("id, name")
    .eq("promoter_id", promoterId)
    .order("created_at", { ascending: false });
  if (error || !templateRows || templateRows.length === 0) return [];
  const ids = (templateRows as ScheduleTemplateRow[]).map((t) => t.id);
  const { data: entryRows } = await supabase
    .from("schedule_template_entries")
    .select("id, template_id, kind, title, stage, offset_minutes, duration_minutes, sort_order")
    .in("template_id", ids);
  const entriesByTemplate = new Map<string, ScheduleTemplateEntryRow[]>();
  for (const row of (entryRows as ScheduleTemplateEntryRow[]) ?? []) {
    const list = entriesByTemplate.get(row.template_id) ?? [];
    list.push(row);
    entriesByTemplate.set(row.template_id, list);
  }
  return (templateRows as ScheduleTemplateRow[]).map((row) =>
    toScheduleTemplate(row, entriesByTemplate.get(row.id) ?? [])
  );
}

// Saves the current event's running order as a reusable template. Callers
// pass entries already stripped to structure-only (see captureTemplateEntries
// in lib/schedule.ts) — artist assignments, private notes and real dates
// never reach this function, let alone get persisted.
export async function saveScheduleAsTemplate(
  supabase: SupabaseClient,
  promoterId: string,
  name: string,
  entries: Array<Omit<ScheduleTemplateEntry, "id">>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: template, error } = await supabase
    .from("schedule_templates")
    .insert({ promoter_id: promoterId, name })
    .select("id")
    .single();
  if (error || !template) return { ok: false, error: error?.message ?? "Couldn't save that template." };
  if (entries.length > 0) {
    const { error: entriesError } = await supabase.from("schedule_template_entries").insert(
      entries.map((e) => ({
        template_id: template.id,
        kind: e.kind,
        title: e.title,
        stage: e.stage,
        offset_minutes: e.offsetMinutes,
        duration_minutes: e.durationMinutes,
        sort_order: e.sortOrder,
      }))
    );
    if (entriesError) return { ok: false, error: entriesError.message };
  }
  return { ok: true };
}

export async function deleteScheduleTemplate(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("schedule_templates").delete().eq("id", id);
  return !error;
}

// Applies a template to this event: claims a version, then inserts every
// built entry (see applyTemplateToEvent in lib/schedule.ts) in one batch.
export async function applyTemplateToSchedule(
  supabase: SupabaseClient,
  scheduleId: string,
  expectedVersion: number,
  entries: Array<Omit<ScheduleEntry, "id" | "scheduleId" | "artistId" | "notes">>
): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const claim = await claimScheduleVersion(supabase, scheduleId, expectedVersion);
  if (!claim.ok) return { ok: false, error: claim.error };
  if (entries.length === 0) return { ok: true, version: claim.version };
  const { error } = await supabase.from("schedule_entries").insert(
    entries.map((e) => ({
      schedule_id: scheduleId,
      kind: e.kind,
      title: e.title,
      stage: e.stage,
      start_at: e.start,
      end_at: e.end,
      sort_order: e.sortOrder,
    }))
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, version: claim.version };
}
