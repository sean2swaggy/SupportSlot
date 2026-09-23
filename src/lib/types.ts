// Core domain types for the Support Slot prototype.
// Everything here is mock/prototype data — no backend yet.

export type Genre =
  | "Alternative"
  | "Electronic"
  | "Indie"
  | "Experimental"
  | "Hip-Hop"
  | "Punk"
  | "Folk"
  | "Pop"
  | "R&B"
  | "Techno"
  | "Drum & Bass"
  | "Rock";

export type UKCity =
  | "London"
  | "Manchester"
  | "Birmingham"
  | "Bristol"
  | "Leeds"
  | "Brighton";

export type VerificationLevel = "verified" | "unverified";

export type ApplicationStatus =
  | "submitted"
  | "viewed"
  | "shortlisted"
  | "booked"
  | "not_selected"
  | "cancelled";

export interface Track {
  id: string;
  title: string;
  duration: string; // "3:24"
  coverImage: string;
}

export interface PastShow {
  id: string;
  headliner: string;
  venue: string;
  city: UKCity | string;
  date: string; // ISO
}

export interface Artist {
  id: string;
  handle: string; // url slug / @name
  name: string;
  image: string;
  bannerImage: string;
  location: UKCity;
  genres: Genre[];
  spotifyUrl: string;
  instagramUrl: string;
  tiktokUrl: string;
  soundcloudUrl?: string;
  bandcampUrl?: string;
  youtubeUrl?: string;
  websiteUrl?: string;
  monthlyListeners: number;
  bio: string;
  liveVideoThumbnail: string;
  liveVideoUrl?: string;
  tracks: Track[];
  pastShows: PastShow[];
  upcomingShows: PastShow[];
  availability: "available" | "limited" | "unavailable";
  travelRadiusMiles: number;
  verification: VerificationLevel;
  artistSize: "emerging" | "developing" | "established";
  lastMinuteAlerts: boolean;
  // Whether this artist's Stripe Connect account can currently receive
  // transfers — false until they complete Stripe's hosted onboarding.
  stripeTransfersActive: boolean;
  memberSince: string;
}

export interface Venue {
  id: string;
  name: string;
  city: UKCity;
  capacity: number;
  address: string;
  image: string;
  verification: VerificationLevel;
}

export interface Promoter {
  id: string;
  name: string;
  company: string;
  avatar: string;
  location?: UKCity;
  verification: VerificationLevel;
  showsPosted: number;
}

export interface SupportSlot {
  id: string;
  headliner: string;
  headlinerImage: string;
  // Optional reference photo of the kind of support artist the promoter is
  // picturing for this slot — separate from the headliner's own banner image.
  artistPhoto?: string;
  // Set when a booked show's date/times have been changed after booking —
  // see lib/slot-schedule.ts.
  rescheduledAt?: string;
  promoterId: string;
  venueId: string;
  city: UKCity;
  date: string; // ISO date
  doorsTime: string; // "19:00"
  setTime: string; // "20:15"
  performanceLengthMins: number;
  genres: Genre[];
  expectedAttendance: number;
  supportFee: number;
  travelContribution: number;
  // Support Slot's own cut, set by the promoter when posting (£10 minimum
  // enforced by the DB) — separate from supportFee, which goes to the artist.
  bookingFee: number;
  requirements: string[];
  applicationDeadline: string; // ISO date
  applicantCount: number;
  isUrgent: boolean;
  postedAt: string; // ISO datetime
  status: "open" | "filled" | "closed";
  artistSizeFit: Array<"emerging" | "developing" | "established">;
  description: string;
}

export interface Application {
  id: string;
  slotId: string;
  artistId: string;
  status: ApplicationStatus;
  submittedAt: string;
  featuredTrackId: string;
  message?: string;
  matchPercent: number;
}

export interface NotificationItem {
  id: string;
  type:
    | "viewed"
    | "shortlisted"
    | "match"
    | "urgent"
    | "booked"
    | "message"
    | "availability_request"
    | "availability_response";
  text: string;
  timeAgo: string;
  read: boolean;
  href?: string;
}

export type Currency = "GBP" | "EUR" | "USD";

// A promoter's private, saved artist — Support+ only. Never visible to the
// artist, never affects their ranking, match score or eligibility for
// anything. See src/app/dashboard/promoter/roster.
export interface RosterEntry {
  id: string;
  artist: Artist;
  notes: string;
  tags: string[];
  addedAt: string;
}

export type AvailabilityResponseValue = "pending" | "available" | "unavailable";
export type AvailabilityRequestStatus = "sent" | "withdrawn" | "filled";

// A pre-booking "are you free" enquiry — never a reservation or a booking.
// Turning an "available" response into a real, paid booking still goes
// through the existing apply/book flow (see linkedSlotId/linkedApplicationId
// on the per-recipient response).
export interface AvailabilityRequest {
  id: string;
  promoterId: string;
  eventName: string;
  eventDate: string; // ISO date
  eventTime: string; // "20:00"
  timezone: string;
  venueName: string;
  venueLocation: string;
  proposedFee: number;
  currency: Currency;
  setLengthMins: number;
  responseDeadline: string; // ISO datetime
  message?: string;
  status: AvailabilityRequestStatus;
  linkedSlotId?: string;
  createdAt: string;
}

export interface AvailabilityRequestRecipient {
  id: string;
  requestId: string;
  artistId: string;
  response: AvailabilityResponseValue;
  respondedAt?: string;
  questionAsked: boolean;
  threadId?: string;
  linkedApplicationId?: string;
  // The linked application's current status, joined in at read time — lets
  // the promoter's requests workspace show "Booked ✓" without depending on
  // the (possibly stale) global applications list in the store, since this
  // application was created directly, not through addApplication().
  linkedApplicationStatus?: ApplicationStatus;
}

// The promoter's view: a request plus every recipient's response, joined —
// avoids a promoter having to stitch two lists together in the UI.
export interface AvailabilityRequestWithRecipients extends AvailabilityRequest {
  recipients: Array<AvailabilityRequestRecipient & { artist: Artist }>;
}

// The artist's view: their own request + response only — no other
// recipient is ever included, by construction (see RLS in
// 0011_availability_requests.sql).
export interface AvailabilityRequestForArtist extends AvailabilityRequest {
  promoterCompany: string;
  promoterAvatar: string;
  myResponse: AvailabilityRequestRecipient;
}

export interface EventTemplate {
  id: string;
  name: string;
  eventName: string;
  venueName: string;
  venueLocation: string;
  proposedFee: number | null;
  currency: Currency;
  setLengthMins: number | null;
  message?: string;
}

export interface MessageThread {
  id: string;
  withName: string;
  withImage: string;
  context: string; // e.g. slot/show name
  lastMessage: string;
  lastMessageAt: string;
  unread: boolean;
  messages: Array<{
    id: string;
    from: "me" | "them";
    text: string;
    time: string;
  }>;
}

export type GigInvitationStatus = "pending" | "accepted" | "declined" | "withdrawn";

// A promoter inviting one artist to apply for one of their own open gigs —
// direct from Discover Artists, free for every promoter (unlike
// AvailabilityRequest, which is Support+ only and roster-scoped). Accepting
// creates a real Application; this never books anything by itself.
export interface GigInvitation {
  id: string;
  slotId: string;
  promoterId: string;
  artistId: string;
  message?: string;
  status: GigInvitationStatus;
  linkedApplicationId?: string;
  createdAt: string;
  respondedAt?: string;
}

export interface GigInvitationForArtist extends GigInvitation {
  slot: SupportSlot;
  promoterCompany: string;
}

export interface GigInvitationForPromoter extends GigInvitation {
  artist: Artist;
}

export type ScheduleEntryKind =
  | "arrival"
  | "load_in"
  | "soundcheck"
  | "doors"
  | "performance"
  | "changeover"
  | "break"
  | "other";

export type ScheduleStatus = "draft" | "final";

// One item on a show's running order. start/end are full ISO datetimes (not
// time-of-day) — see 0016_show_schedules.sql for why: it's what makes an
// event that runs past midnight just work, with no day-rollover
// special-casing anywhere. sortOrder is a separate display-order value
// within (stage) that drag-and-drop / the reorder buttons touch — moving an
// entry up or down never changes its start/end.
export interface ScheduleEntry {
  id: string;
  scheduleId: string;
  kind: ScheduleEntryKind;
  title: string;
  stage: string;
  start: string; // ISO datetime, naive (no tz) — Europe/London wall-clock throughout
  end: string; // ISO datetime, naive (no tz)
  artistId?: string;
  notes: string;
  sortOrder: number;
}

// One event's (slot's) private running order — Support+ only, promoter-owned,
// never artist-facing. `version` backs optimistic-concurrency saves (see
// claim_schedule_version() in the migration) — the client must hold the
// version it last read and re-fetch on a "stale_schedule_version" conflict
// rather than retry blindly.
export interface ShowSchedule {
  id: string;
  slotId: string;
  promoterId: string;
  status: ScheduleStatus;
  version: number;
  entries: ScheduleEntry[];
  updatedAt: string;
}

// Reusable running-order structure — kind/title/stage/duration/order only.
// Deliberately carries no artist assignments, notes or real dates: applying
// a template to an event never pulls a previous show's artists or private
// notes forward, and never invents new ones.
export interface ScheduleTemplateEntry {
  id: string;
  kind: ScheduleEntryKind;
  title: string;
  stage: string;
  offsetMinutes: number; // minutes from a nominal "event start" (0)
  durationMinutes: number;
  sortOrder: number;
}

export interface ScheduleTemplate {
  id: string;
  name: string;
  entries: ScheduleTemplateEntry[];
}
