// Converts snake_case Supabase rows into the exact camelCase shapes defined
// in src/lib/types.ts, so the ~30 files that already consume those types
// (artist.spotifyUrl, not artist.spotify_url) don't need to change.

import type {
  Application,
  ApplicationStatus,
  Artist,
  AvailabilityRequest,
  AvailabilityRequestForArtist,
  AvailabilityRequestRecipient,
  AvailabilityRequestWithRecipients,
  AvailabilityResponseValue,
  Currency,
  EventTemplate,
  Genre,
  GigInvitation,
  GigInvitationForArtist,
  GigInvitationForPromoter,
  GigInvitationStatus,
  MessageThread,
  NotificationItem,
  PastShow,
  Promoter,
  RosterEntry,
  ScheduleEntry,
  ScheduleEntryKind,
  ScheduleStatus,
  ScheduleTemplate,
  ScheduleTemplateEntry,
  ShowSchedule,
  SupportSlot,
  Track,
  UKCity,
  Venue,
} from "@/lib/types";
import { timeAgo } from "@/lib/utils";

export interface ArtistRow {
  id: string;
  handle: string;
  name: string;
  image_url: string | null;
  banner_image_url: string | null;
  location: string;
  genres: string[];
  spotify_url: string;
  instagram_url: string;
  tiktok_url: string;
  soundcloud_url: string | null;
  bandcamp_url: string | null;
  youtube_url: string | null;
  website_url: string | null;
  monthly_listeners: number | null;
  bio: string;
  live_video_thumbnail_url: string | null;
  live_video_url: string | null;
  availability: string;
  travel_radius_miles: number;
  verification: string;
  artist_size: string;
  last_minute_alerts: boolean;
  stripe_transfers_active?: boolean;
  member_since: string;
}

export interface ArtistTrackRow {
  id: string;
  title: string;
  duration: string;
  cover_image_url: string | null;
}

export interface ArtistShowRow {
  id: string;
  kind: "past" | "upcoming";
  headliner: string;
  venue: string;
  city: string;
  date: string;
}

export function toArtist(
  row: ArtistRow,
  tracks: ArtistTrackRow[] = [],
  shows: ArtistShowRow[] = []
): Artist {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    image: row.image_url ?? "",
    bannerImage: row.banner_image_url ?? "",
    location: row.location as UKCity,
    genres: row.genres as Genre[],
    spotifyUrl: row.spotify_url,
    instagramUrl: row.instagram_url,
    tiktokUrl: row.tiktok_url,
    soundcloudUrl: row.soundcloud_url ?? undefined,
    bandcampUrl: row.bandcamp_url ?? undefined,
    youtubeUrl: row.youtube_url ?? undefined,
    websiteUrl: row.website_url ?? undefined,
    monthlyListeners: row.monthly_listeners ?? 0,
    bio: row.bio,
    liveVideoThumbnail: row.live_video_thumbnail_url ?? "",
    liveVideoUrl: row.live_video_url ?? undefined,
    tracks: tracks.map(toTrack),
    pastShows: shows.filter((s) => s.kind === "past").map(toPastShow),
    upcomingShows: shows.filter((s) => s.kind === "upcoming").map(toPastShow),
    availability: row.availability as Artist["availability"],
    travelRadiusMiles: row.travel_radius_miles,
    verification: row.verification as Artist["verification"],
    artistSize: row.artist_size as Artist["artistSize"],
    lastMinuteAlerts: row.last_minute_alerts,
    stripeTransfersActive: row.stripe_transfers_active ?? false,
    memberSince: row.member_since,
  };
}

function toTrack(row: ArtistTrackRow): Track {
  return {
    id: row.id,
    title: row.title,
    duration: row.duration,
    coverImage: row.cover_image_url ?? "",
  };
}

function toPastShow(row: ArtistShowRow): PastShow {
  return {
    id: row.id,
    headliner: row.headliner,
    venue: row.venue,
    city: row.city,
    date: row.date,
  };
}

export interface PromoterRow {
  id: string;
  name: string;
  company: string;
  avatar_url: string | null;
  location: string | null;
  verification: string;
  shows_posted: number;
}

export function toPromoter(row: PromoterRow): Promoter {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    avatar: row.avatar_url ?? "",
    location: (row.location ?? undefined) as UKCity | undefined,
    verification: row.verification as Promoter["verification"],
    showsPosted: row.shows_posted,
  };
}

export interface VenueRow {
  id: string;
  name: string;
  city: string;
  capacity: number;
  address: string;
  image_url: string | null;
  verification: string;
}

export function toVenue(row: VenueRow): Venue {
  return {
    id: row.id,
    name: row.name,
    city: row.city as UKCity,
    capacity: row.capacity,
    address: row.address,
    image: row.image_url ?? "",
    verification: row.verification as Venue["verification"],
  };
}

export interface SlotRow {
  id: string;
  promoter_id: string;
  venue_id: string;
  headliner: string;
  headliner_image_url: string | null;
  artist_photo_url: string | null;
  city: string;
  date: string;
  doors_time: string;
  set_time: string;
  performance_length_mins: number;
  genres: string[];
  expected_attendance: number;
  support_fee: number;
  travel_contribution: number;
  booking_fee: number;
  requirements: string[];
  application_deadline: string;
  applicant_count: number;
  is_urgent: boolean;
  status: string;
  artist_size_fit: string[];
  description: string;
  rescheduled_at: string | null;
  posted_at: string;
}

export function toSlot(row: SlotRow): SupportSlot {
  return {
    id: row.id,
    headliner: row.headliner,
    headlinerImage: row.headliner_image_url ?? "",
    artistPhoto: row.artist_photo_url ?? undefined,
    rescheduledAt: row.rescheduled_at ?? undefined,
    promoterId: row.promoter_id,
    venueId: row.venue_id,
    city: row.city as UKCity,
    date: row.date,
    doorsTime: row.doors_time.slice(0, 5),
    setTime: row.set_time.slice(0, 5),
    performanceLengthMins: row.performance_length_mins,
    genres: row.genres as Genre[],
    expectedAttendance: row.expected_attendance,
    supportFee: row.support_fee,
    travelContribution: row.travel_contribution,
    bookingFee: row.booking_fee,
    requirements: row.requirements,
    applicationDeadline: row.application_deadline,
    applicantCount: row.applicant_count,
    isUrgent: row.is_urgent,
    postedAt: row.posted_at,
    status: row.status as SupportSlot["status"],
    artistSizeFit: row.artist_size_fit as SupportSlot["artistSizeFit"],
    description: row.description,
  };
}

export interface ApplicationRow {
  id: string;
  slot_id: string;
  artist_id: string;
  status: string;
  featured_track_id: string | null;
  message: string | null;
  match_percent: number;
  submitted_at: string;
}

export function toApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    slotId: row.slot_id,
    artistId: row.artist_id,
    status: row.status as ApplicationStatus,
    submittedAt: row.submitted_at,
    featuredTrackId: row.featured_track_id ?? "",
    message: row.message ?? undefined,
    matchPercent: row.match_percent,
  };
}

export interface NotificationRow {
  id: string;
  type: string;
  text: string;
  href: string | null;
  read: boolean;
  created_at: string;
}

export function toNotification(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    type: row.type as NotificationItem["type"],
    text: row.text,
    timeAgo: timeAgo(row.created_at),
    read: row.read,
    href: row.href ?? undefined,
  };
}

export interface MessageThreadRow {
  id: string;
  context: string | null;
  artist_last_read_at: string | null;
  promoter_last_read_at: string | null;
}

export interface MessageRow {
  id: string;
  thread_id: string;
  sender_id: string;
  text: string;
  created_at: string;
}

// `viewerRole` decides which side's read-state and "from: me|them" mapping
// applies — the same thread row looks different depending on who's viewing it.
export function toMessageThread(
  row: MessageThreadRow,
  messages: MessageRow[],
  opts: {
    viewerRole: "artist" | "promoter";
    viewerId: string;
    withName: string;
    withImage: string;
  }
): MessageThread {
  const sorted = [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const last = sorted[sorted.length - 1];
  const lastReadAt =
    opts.viewerRole === "artist" ? row.artist_last_read_at : row.promoter_last_read_at;
  const unread = last
    ? last.sender_id !== opts.viewerId &&
      (!lastReadAt || new Date(last.created_at) > new Date(lastReadAt))
    : false;

  return {
    id: row.id,
    withName: opts.withName,
    withImage: opts.withImage,
    context: row.context ?? "",
    lastMessage: last
      ? `${last.sender_id === opts.viewerId ? "You: " : ""}${last.text}`
      : "",
    lastMessageAt: last?.created_at ?? "",
    unread,
    messages: sorted.map((m) => ({
      id: m.id,
      from: m.sender_id === opts.viewerId ? ("me" as const) : ("them" as const),
      text: m.text,
      time: m.created_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Artist Roster
// ---------------------------------------------------------------------------

export interface RosterRow {
  id: string;
  notes: string;
  tags: string[];
  added_at: string;
  artists: ArtistRow;
}

export function toRosterEntry(row: RosterRow, tracks: ArtistTrackRow[] = [], shows: ArtistShowRow[] = []): RosterEntry {
  return {
    id: row.id,
    artist: toArtist(row.artists, tracks, shows),
    notes: row.notes,
    tags: row.tags,
    addedAt: row.added_at,
  };
}

// ---------------------------------------------------------------------------
// Event templates
// ---------------------------------------------------------------------------

export interface EventTemplateRow {
  id: string;
  name: string;
  event_name: string;
  venue_name: string;
  venue_location: string;
  proposed_fee: number | null;
  currency: string;
  set_length_mins: number | null;
  message: string | null;
}

export function toEventTemplate(row: EventTemplateRow): EventTemplate {
  return {
    id: row.id,
    name: row.name,
    eventName: row.event_name,
    venueName: row.venue_name,
    venueLocation: row.venue_location,
    proposedFee: row.proposed_fee,
    currency: row.currency as Currency,
    setLengthMins: row.set_length_mins,
    message: row.message ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Availability requests
// ---------------------------------------------------------------------------

export interface AvailabilityRequestRow {
  id: string;
  promoter_id: string;
  event_name: string;
  event_date: string;
  event_time: string;
  timezone: string;
  venue_name: string;
  venue_location: string;
  proposed_fee: number;
  currency: string;
  set_length_mins: number;
  response_deadline: string;
  message: string | null;
  status: string;
  linked_slot_id: string | null;
  created_at: string;
}

export interface AvailabilityRequestRecipientRow {
  id: string;
  request_id: string;
  artist_id: string;
  response: string;
  responded_at: string | null;
  question_asked: boolean;
  thread_id: string | null;
  linked_application_id: string | null;
  // Present only when the caller's select() embeds it (see
  // getAvailabilityRequestsForPromoter) — PostgREST auto-joins on the
  // linked_application_id foreign key.
  applications?: { status: string } | null;
}

export function toAvailabilityRequest(row: AvailabilityRequestRow): AvailabilityRequest {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    eventName: row.event_name,
    eventDate: row.event_date,
    eventTime: row.event_time,
    timezone: row.timezone,
    venueName: row.venue_name,
    venueLocation: row.venue_location,
    proposedFee: row.proposed_fee,
    currency: row.currency as Currency,
    setLengthMins: row.set_length_mins,
    responseDeadline: row.response_deadline,
    message: row.message ?? undefined,
    status: row.status as AvailabilityRequest["status"],
    linkedSlotId: row.linked_slot_id ?? undefined,
    createdAt: row.created_at,
  };
}

export function toAvailabilityRequestRecipient(row: AvailabilityRequestRecipientRow): AvailabilityRequestRecipient {
  return {
    id: row.id,
    requestId: row.request_id,
    artistId: row.artist_id,
    response: row.response as AvailabilityResponseValue,
    respondedAt: row.responded_at ?? undefined,
    questionAsked: row.question_asked,
    threadId: row.thread_id ?? undefined,
    linkedApplicationId: row.linked_application_id ?? undefined,
    linkedApplicationStatus: (row.applications?.status as ApplicationStatus | undefined) ?? undefined,
  };
}

export function toAvailabilityRequestWithRecipients(
  row: AvailabilityRequestRow,
  recipients: Array<AvailabilityRequestRecipientRow & { artists: ArtistRow }>
): AvailabilityRequestWithRecipients {
  return {
    ...toAvailabilityRequest(row),
    recipients: recipients.map((r) => ({
      ...toAvailabilityRequestRecipient(r),
      artist: toArtist(r.artists),
    })),
  };
}

export function toAvailabilityRequestForArtist(
  row: AvailabilityRequestRow,
  recipientRow: AvailabilityRequestRecipientRow,
  promoter: { company: string; avatar_url: string | null }
): AvailabilityRequestForArtist {
  return {
    ...toAvailabilityRequest(row),
    promoterCompany: promoter.company,
    promoterAvatar: promoter.avatar_url ?? "",
    myResponse: toAvailabilityRequestRecipient(recipientRow),
  };
}

// ---------------------------------------------------------------------------
// Gig invitations
// ---------------------------------------------------------------------------

export interface GigInvitationRow {
  id: string;
  slot_id: string;
  promoter_id: string;
  artist_id: string;
  message: string | null;
  status: string;
  linked_application_id: string | null;
  created_at: string;
  responded_at: string | null;
}

export function toGigInvitation(row: GigInvitationRow): GigInvitation {
  return {
    id: row.id,
    slotId: row.slot_id,
    promoterId: row.promoter_id,
    artistId: row.artist_id,
    message: row.message ?? undefined,
    status: row.status as GigInvitationStatus,
    linkedApplicationId: row.linked_application_id ?? undefined,
    createdAt: row.created_at,
    respondedAt: row.responded_at ?? undefined,
  };
}

export function toGigInvitationForArtist(
  row: GigInvitationRow,
  slot: SlotRow,
  promoter: { company: string }
): GigInvitationForArtist {
  return {
    ...toGigInvitation(row),
    slot: toSlot(slot),
    promoterCompany: promoter.company,
  };
}

export function toGigInvitationForPromoter(row: GigInvitationRow, artist: ArtistRow): GigInvitationForPromoter {
  return {
    ...toGigInvitation(row),
    artist: toArtist(artist),
  };
}

export interface ScheduleEntryRow {
  id: string;
  schedule_id: string;
  kind: string;
  title: string;
  stage: string;
  start_at: string;
  end_at: string;
  artist_id: string | null;
  notes: string;
  sort_order: number;
}

export function toScheduleEntry(row: ScheduleEntryRow): ScheduleEntry {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    kind: row.kind as ScheduleEntryKind,
    title: row.title,
    stage: row.stage,
    start: row.start_at,
    end: row.end_at,
    artistId: row.artist_id ?? undefined,
    notes: row.notes,
    sortOrder: row.sort_order,
  };
}

export interface ShowScheduleRow {
  id: string;
  slot_id: string;
  promoter_id: string;
  status: string;
  version: number;
  updated_at: string;
}

export function toShowSchedule(row: ShowScheduleRow, entries: ScheduleEntryRow[]): ShowSchedule {
  return {
    id: row.id,
    slotId: row.slot_id,
    promoterId: row.promoter_id,
    status: row.status as ScheduleStatus,
    version: row.version,
    entries: entries.map(toScheduleEntry),
    updatedAt: row.updated_at,
  };
}

export interface ScheduleTemplateEntryRow {
  id: string;
  template_id: string;
  kind: string;
  title: string;
  stage: string;
  offset_minutes: number;
  duration_minutes: number;
  sort_order: number;
}

export function toScheduleTemplateEntry(row: ScheduleTemplateEntryRow): ScheduleTemplateEntry {
  return {
    id: row.id,
    kind: row.kind as ScheduleEntryKind,
    title: row.title,
    stage: row.stage,
    offsetMinutes: row.offset_minutes,
    durationMinutes: row.duration_minutes,
    sortOrder: row.sort_order,
  };
}

export interface ScheduleTemplateRow {
  id: string;
  name: string;
}

export function toScheduleTemplate(
  row: ScheduleTemplateRow,
  entries: ScheduleTemplateEntryRow[]
): ScheduleTemplate {
  return {
    id: row.id,
    name: row.name,
    entries: entries.map(toScheduleTemplateEntry).sort((a, b) => a.sortOrder - b.sortOrder),
  };
}
