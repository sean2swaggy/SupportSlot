import type {
  NewAccount, Notification, ThreadSummary, ThreadView,
  ApplicantView, ApplicationView, BookingView, Listing, SlotView, User,
} from "../domain/types";

export interface SlotFilters { genre?: string; city?: string; q?: string }
export interface NewListing {
  venue: string; city: string; date: string; doors: string; setTime: string;
  setMinutes: number; genres: string[]; capacity: number; feePence: number; notes: string;
}

/** Everything the UI needs from a backend. The browser implementation is in
 *  localRepo.ts; a Supabase one can replace it without touching any screen.
 *  Every write is validated by the implementation (who is asking, what state
 *  things are in) and re-read by the caller afterwards. */
export interface Repo {
  // accounts (local demo auth; a real backend replaces these)
  signUp(a: NewAccount): Promise<User>;
  signIn(email: string, password: string): Promise<User>;
  user(id: string): Promise<User | null>;
  updateProfile(userId: string, patch: Pick<User, "name" | "city" | "genres" | "blurb">): Promise<User>;
  // notifications and messages
  notifications(userId: string): Promise<Notification[]>;
  markAllRead(userId: string): Promise<void>;
  threads(userId: string): Promise<ThreadSummary[]>;
  thread(listingId: string, artistId: string, userId: string): Promise<ThreadView>;
  sendMessage(listingId: string, artistId: string, fromId: string, text: string): Promise<void>;
  // artist
  openSlots(artistId: string, f: SlotFilters): Promise<SlotView[]>;
  slot(id: string, artistId: string): Promise<SlotView>;
  apply(listingId: string, artistId: string, message: string): Promise<void>;
  withdraw(applicationId: string, artistId: string): Promise<void>;
  myApplications(artistId: string): Promise<ApplicationView[]>;
  // both
  myBookings(userId: string): Promise<BookingView[]>;
  booking(id: string, userId: string): Promise<BookingView>;
  cancelBooking(id: string, userId: string, reason: string): Promise<void>;
  // promoter
  myListings(promoterId: string): Promise<SlotView[]>;
  createListing(promoterId: string, input: NewListing): Promise<Listing>;
  cancelListing(id: string, promoterId: string): Promise<void>;
  applicants(listingId: string, promoterId: string): Promise<{ listing: Listing; applicants: ApplicantView[]; booking?: BookingView }>;
  accept(applicationId: string, promoterId: string): Promise<string>; // returns booking id
  decline(applicationId: string, promoterId: string): Promise<void>;
}

export class RepoError extends Error {
  constructor(public code: "not_found" | "forbidden" | "auth" | "conflict" | "invalid" | "network", message: string) {
    super(message);
  }
}
