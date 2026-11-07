export type Role = "artist" | "promoter";

export interface User {
  id: string;
  role: Role;
  name: string; // stage name or promoter name
  city: string;
  genres: string[];
  blurb: string;
}

export type ListingStatus = "open" | "booked" | "cancelled";

export interface Listing {
  id: string;
  promoterId: string;
  venue: string;
  city: string;
  date: string; // UK calendar date, YYYY-MM-DD (never a timestamp)
  doors: string; // "19:00" naive local time
  setTime: string;
  setMinutes: number;
  genres: string[];
  capacity: number;
  feePence: number; // integer pence; no money moves through Support Slot
  notes: string;
  status: ListingStatus;
  createdAt: string;
}

export type ApplicationStatus = "pending" | "accepted" | "declined" | "withdrawn";

export interface Application {
  id: string;
  listingId: string;
  artistId: string;
  message: string;
  status: ApplicationStatus;
  createdAt: string;
}

export type BookingStatus = "confirmed" | "cancelled";

export interface Booking {
  id: string;
  ref: string;
  listingId: string;
  applicationId: string;
  artistId: string;
  promoterId: string;
  feePence: number; // snapshot at the moment of booking
  status: BookingStatus;
  createdAt: string;
  cancelledBy?: string;
  cancelReason?: string;
  cancelledAt?: string;
}

export interface Account { userId: string; email: string; salt: string; hash: string }
export interface Notification { id: string; userId: string; text: string; link: string; createdAt: string; read: boolean }
export interface Message { id: string; listingId: string; artistId: string; fromId: string; text: string; createdAt: string }

export interface Db {
  accounts: Account[];
  notifications: Notification[];
  messages: Message[];
  users: User[];
  listings: Listing[];
  applications: Application[];
  bookings: Booking[];
}

// View shapes returned by the repository
export interface SlotView extends Listing {
  promoterName: string;
  applied: boolean; // for the asking artist
  applicantCount: number;
}
export interface BookingView extends Booking {
  listing: Listing;
  artist: User;
  promoter: User;
}
export interface ApplicationView extends Application {
  listing: Listing;
  promoterName: string;
}
export interface ApplicantView extends Application {
  artist: User;
}

export interface ThreadView {
  listing: Listing;
  artist: User;
  promoter: User;
  messages: Message[];
}
export interface ThreadSummary { listing: Listing; other: User; artistId: string; last?: Message; unreadHint: boolean }
export interface NewAccount { email: string; password: string; role: Role; name: string; city: string; genres: string[]; blurb: string }
