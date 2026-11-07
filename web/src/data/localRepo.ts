import { isPast, todayLondon } from "../domain/dates";
import type {
  Application, ApplicantView, ApplicationView, Booking, BookingView, Db, Listing, SlotView, User,
} from "../domain/types";
import { RepoError, type NewListing, type Repo, type SlotFilters } from "./repo";
import { seed } from "./seed";

const KEY = "support-slot:db:v1";

export interface Storage2 { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

interface Options {
  storage?: Storage2 | null; // null = in-memory only
  latencyMs?: number;
  today?: () => string;
  failNext?: () => boolean; // test hook / ?simulate=error
}

/** Browser-persisted implementation of Repo. Each write is one synchronous
 *  load → validate → mutate → save, so rules hold even with two tabs open
 *  (last write wins on the whole blob; fine for a demo, not for production). */
export function createLocalRepo(opts: Options = {}): Repo & { reset(): void } {
  const storage = opts.storage === undefined ? safeLocalStorage() : opts.storage;
  const latency = opts.latencyMs ?? 350;
  const today = opts.today ?? (() => todayLondon());
  let memory: Db | null = null;

  const load = (): Db => {
    if (storage) {
      try {
        const raw = storage.getItem(KEY);
        if (raw) return JSON.parse(raw) as Db;
      } catch { /* fall through to seed */ }
      const fresh = seed(today());
      storage.setItem(KEY, JSON.stringify(fresh));
      return fresh;
    }
    return (memory ??= seed(today()));
  };
  const save = (db: Db) => {
    if (storage) storage.setItem(KEY, JSON.stringify(db));
    else memory = db;
  };
  const gate = async () => {
    if (latency) await new Promise((r) => setTimeout(r, latency));
    if (opts.failNext?.()) throw new RepoError("network", "We couldn't reach the server. Check your connection and try again.");
  };
  const read = async <T,>(fn: (db: Db) => T): Promise<T> => { await gate(); return fn(load()); };
  const write = async <T,>(fn: (db: Db) => T): Promise<T> => {
    await gate();
    const db = load();
    const out = fn(db);
    save(db);
    return out;
  };

  const user = (db: Db, id: string): User => {
    const u = db.users.find((x) => x.id === id);
    if (!u) throw new RepoError("not_found", "That person no longer exists.");
    return u;
  };
  const listing = (db: Db, id: string): Listing => {
    const l = db.listings.find((x) => x.id === id);
    if (!l) throw new RepoError("not_found", "That listing could not be found.");
    return l;
  };
  const asSlot = (db: Db, l: Listing, artistId?: string): SlotView => ({
    ...l,
    promoterName: user(db, l.promoterId).name,
    applied: !!artistId && db.applications.some((a) => a.listingId === l.id && a.artistId === artistId && (a.status === "pending" || a.status === "accepted")),
    applicantCount: db.applications.filter((a) => a.listingId === l.id && a.status === "pending").length,
  });
  const asBooking = (db: Db, b: Booking): BookingView => ({
    ...b, listing: listing(db, b.listingId), artist: user(db, b.artistId), promoter: user(db, b.promoterId),
  });
  const requireRole = (db: Db, id: string, role: "artist" | "promoter") => {
    if (user(db, id).role !== role) throw new RepoError("forbidden", `Only ${role}s can do that.`);
  };
  const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;
  const newRef = () => `SS-${Math.floor(1000 + Math.random() * 9000)}`;

  const repo: Repo & { reset(): void } = {
    reset() { if (storage) storage.removeItem(KEY); memory = null; },
    // the profile list is cached by the app shell; deliberately not subject to simulated failures
    users: async () => load().users,

    openSlots: (artistId, f: SlotFilters) => read((db) => {
      const q = f.q?.trim().toLowerCase();
      return db.listings
        .filter((l) => l.status === "open" && !isPast(l.date, today()))
        .filter((l) => !f.genre || l.genres.includes(f.genre))
        .filter((l) => !f.city || l.city === f.city)
        .filter((l) => !q || `${l.venue} ${l.city} ${l.notes}`.toLowerCase().includes(q))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((l) => asSlot(db, l, artistId));
    }),
    slot: (id, artistId) => read((db) => asSlot(db, listing(db, id), artistId)),

    apply: (listingId, artistId, message) => write((db) => {
      requireRole(db, artistId, "artist");
      const l = listing(db, listingId);
      if (l.status !== "open" || isPast(l.date, today())) throw new RepoError("conflict", "This slot is no longer open.");
      if (db.applications.some((a) => a.listingId === listingId && a.artistId === artistId && (a.status === "pending" || a.status === "accepted"))) return; // idempotent
      if (message.trim().length < 10) throw new RepoError("invalid", "Tell the promoter a little about your set (at least 10 characters).");
      db.applications.push({ id: newId("a"), listingId, artistId, message: message.trim().slice(0, 600), status: "pending", createdAt: new Date().toISOString() });
    }),
    withdraw: (applicationId, artistId) => write((db) => {
      const a = db.applications.find((x) => x.id === applicationId);
      if (!a || a.artistId !== artistId) throw new RepoError("not_found", "Application not found.");
      if (a.status === "withdrawn") return;
      if (a.status !== "pending") throw new RepoError("conflict", "Only a pending request can be withdrawn. Cancel the booking instead.");
      a.status = "withdrawn";
    }),
    myApplications: (artistId) => read((db) => db.applications
      .filter((a) => a.artistId === artistId && a.status === "pending")
      .map((a): ApplicationView => ({ ...a, listing: listing(db, a.listingId), promoterName: user(db, listing(db, a.listingId).promoterId).name }))
      .sort((a, b) => a.listing.date.localeCompare(b.listing.date))),

    myBookings: (userId) => read((db) => db.bookings
      .filter((b) => b.artistId === userId || b.promoterId === userId)
      .map((b) => asBooking(db, b))
      .sort((a, b) => a.listing.date.localeCompare(b.listing.date))),
    booking: (id, userId) => read((db) => {
      const b = db.bookings.find((x) => x.id === id);
      if (!b || (b.artistId !== userId && b.promoterId !== userId)) throw new RepoError("not_found", "That booking could not be found.");
      return asBooking(db, b);
    }),
    cancelBooking: (id, userId, reason) => write((db) => {
      const b = db.bookings.find((x) => x.id === id);
      if (!b || (b.artistId !== userId && b.promoterId !== userId)) throw new RepoError("not_found", "That booking could not be found.");
      if (b.status === "cancelled") return; // idempotent
      const l = listing(db, b.listingId);
      if (isPast(l.date, today())) throw new RepoError("conflict", "This show has already happened, so it can't be cancelled.");
      if (reason.trim().length < 5) throw new RepoError("invalid", "Please give a short reason; the other person will see it.");
      b.status = "cancelled"; b.cancelledBy = userId; b.cancelReason = reason.trim().slice(0, 400); b.cancelledAt = new Date().toISOString();
      const app = db.applications.find((a) => a.id === b.applicationId);
      if (userId === b.artistId) {
        // artist drops out: the slot reopens for other acts
        l.status = "open";
        if (app) app.status = "withdrawn";
      } else {
        l.status = "cancelled";
      }
    }),

    myListings: (promoterId) => read((db) => db.listings
      .filter((l) => l.promoterId === promoterId)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((l) => asSlot(db, l))),
    createListing: (promoterId, input: NewListing) => write((db) => {
      requireRole(db, promoterId, "promoter");
      if (!input.venue.trim() || !input.city.trim()) throw new RepoError("invalid", "Add a venue and a city.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || isPast(input.date, today())) throw new RepoError("invalid", "Choose a date from today onwards.");
      if (input.setMinutes < 10 || input.setMinutes > 90) throw new RepoError("invalid", "Set length must be between 10 and 90 minutes.");
      if (input.genres.length === 0) throw new RepoError("invalid", "Pick at least one genre.");
      if (input.feePence < 0 || input.feePence > 1_000_000) throw new RepoError("invalid", "Enter a fee between £0 and £10,000.");
      const l: Listing = { ...input, venue: input.venue.trim(), city: input.city.trim(), id: newId("l"), promoterId, status: "open", createdAt: new Date().toISOString() };
      db.listings.push(l);
      return l;
    }),
    cancelListing: (id, promoterId) => write((db) => {
      const l = listing(db, id);
      if (l.promoterId !== promoterId) throw new RepoError("forbidden", "That isn't your listing.");
      if (l.status === "cancelled") return;
      if (db.bookings.some((b) => b.listingId === id && b.status === "confirmed")) throw new RepoError("conflict", "This slot has a confirmed act. Cancel the booking instead so they're told why.");
      l.status = "cancelled";
      db.applications.filter((a) => a.listingId === id && a.status === "pending").forEach((a) => { a.status = "declined"; });
    }),
    applicants: (listingId, promoterId) => read((db) => {
      const l = listing(db, listingId);
      if (l.promoterId !== promoterId) throw new RepoError("forbidden", "That isn't your listing.");
      const applicants: ApplicantView[] = db.applications
        .filter((a) => a.listingId === listingId)
        .map((a: Application) => ({ ...a, artist: user(db, a.artistId) }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const b = db.bookings.find((x) => x.listingId === listingId && x.status === "confirmed");
      return { listing: l, applicants, booking: b ? asBooking(db, b) : undefined };
    }),
    accept: (applicationId, promoterId) => write((db) => {
      const a = db.applications.find((x) => x.id === applicationId);
      if (!a) throw new RepoError("not_found", "Application not found.");
      const l = listing(db, a.listingId);
      if (l.promoterId !== promoterId) throw new RepoError("forbidden", "That isn't your listing.");
      if (a.status === "accepted") return db.bookings.find((b) => b.applicationId === a.id)!.id; // idempotent
      if (a.status !== "pending") throw new RepoError("conflict", "That request is no longer pending.");
      if (l.status !== "open" || isPast(l.date, today())) throw new RepoError("conflict", "This slot is no longer open.");
      a.status = "accepted";
      db.applications.filter((o) => o.listingId === l.id && o.id !== a.id && o.status === "pending").forEach((o) => { o.status = "declined"; });
      l.status = "booked";
      const b: Booking = { id: newId("b"), ref: newRef(), listingId: l.id, applicationId: a.id, artistId: a.artistId, promoterId, feePence: l.feePence, status: "confirmed", createdAt: new Date().toISOString() };
      db.bookings.push(b);
      return b.id;
    }),
    decline: (applicationId, promoterId) => write((db) => {
      const a = db.applications.find((x) => x.id === applicationId);
      if (!a) throw new RepoError("not_found", "Application not found.");
      if (listing(db, a.listingId).promoterId !== promoterId) throw new RepoError("forbidden", "That isn't your listing.");
      if (a.status === "declined") return;
      if (a.status !== "pending") throw new RepoError("conflict", "That request is no longer pending.");
      a.status = "declined";
    }),
  };
  return repo;
}

function safeLocalStorage(): Storage2 | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
