import { addDays, todayLondon } from "../domain/dates";
import type { Application, Booking, Db, Listing, User } from "../domain/types";

/** Realistic sample data, generated relative to today so the app always has
 *  upcoming shows. All of this is fictional. */
export function seed(today = todayLondon()): Db {
  const users: User[] = [
    { id: "u-maya", role: "artist", name: "Maya Okafor", city: "Leeds", genres: ["Folk", "Singer-songwriter"], blurb: "Solo guitar and voice. Forty-minute sets, comfortable with a quiet room." },
    { id: "u-orchard", role: "artist", name: "The Static Orchard", city: "Manchester", genres: ["Indie", "Rock"], blurb: "Four-piece, own backline for small stages. Two EPs out." },
    { id: "u-harbour", role: "promoter", name: "Harbour Lights Presents", city: "Bristol", genres: ["Folk", "Indie", "Soul"], blurb: "Monthly nights in two small Bristol rooms." },
    { id: "u-north", role: "promoter", name: "Northern Echo Promotions", city: "Sheffield", genres: ["Rock", "Punk", "Electronic"], blurb: "Independent promoter running Sheffield and Leeds shows since 2016." },
  ];
  const L = (id: string, promoterId: string, venue: string, city: string, offset: number, doors: string, setTime: string,
    setMinutes: number, genres: string[], capacity: number, feePounds: number, notes: string, status: Listing["status"] = "open"): Listing => ({
    id, promoterId, venue, city, date: addDays(today, offset), doors, setTime, setMinutes, genres, capacity,
    feePence: feePounds * 100, notes, status, createdAt: addDays(today, -20) + "T10:00:00Z",
  });
  const listings: Listing[] = [
    L("l-1", "u-harbour", "The Lantern Room", "Bristol", 6, "19:00", "19:45", 30, ["Folk", "Singer-songwriter"], 120, 80, "Seated room, house PA and a sound engineer. Parking is limited; the venue is five minutes from the station."),
    L("l-2", "u-north", "Dial House", "Sheffield", 9, "19:30", "20:00", 35, ["Rock", "Punk"], 250, 120, "Loud room, full backline provided. Support load-in at 17:30.", "booked"),
    L("l-3", "u-harbour", "The Cellar at Number 9", "Bristol", 13, "20:00", "20:30", 30, ["Indie", "Soul"], 90, 60, "Intimate cellar bar, acoustic or stripped-back sets work best."),
    L("l-4", "u-north", "Foundry Social", "Leeds", 16, "19:00", "19:40", 30, ["Indie", "Rock"], 180, 100, "Headliner is a touring four-piece. Meal and two drinks for the support act."),
    L("l-5", "u-north", "The Wire Works", "Sheffield", 22, "20:00", "20:45", 40, ["Electronic", "Hip-hop"], 300, 150, "DJ-friendly stage with a full rig. Bring your own controller."),
    L("l-6", "u-harbour", "St Anne's Chapel", "Bristol", 28, "18:30", "19:15", 30, ["Folk", "Jazz"], 140, 90, "Converted chapel, quiet and attentive crowd. No drums."),
    L("l-7", "u-north", "Dial House", "Sheffield", 35, "19:30", "20:00", 30, ["Punk", "Metal"], 250, 100, "Double-bill night. Two supports will play; split the fee as listed."),
    L("l-8", "u-harbour", "The Lantern Room", "Bristol", 44, "19:00", "19:45", 30, ["Singer-songwriter", "Folk"], 120, 0, "Charity night. Expenses covered, no fee. Good exposure for newer acts."),
    L("l-9", "u-north", "Foundry Social", "Leeds", 52, "19:00", "19:45", 35, ["Indie", "Electronic"], 180, 110, "Album launch night for the headliner."),
    // past
    L("l-p1", "u-harbour", "The Lantern Room", "Bristol", -24, "19:00", "19:45", 30, ["Folk"], 120, 75, "Past show.", "booked"),
    L("l-p2", "u-north", "Foundry Social", "Leeds", -10, "19:30", "20:00", 30, ["Indie"], 180, 90, "Past show.", "cancelled"),
  ];
  const A = (id: string, listingId: string, artistId: string, message: string, status: Application["status"], daysAgo: number): Application => ({
    id, listingId, artistId, message, status, createdAt: addDays(today, -daysAgo) + "T12:00:00Z",
  });
  const applications: Application[] = [
    A("a-1", "l-1", "u-orchard", "We play a stripped-back acoustic set too, happy to fit a thirty-minute slot.", "pending", 2),
    A("a-2", "l-2", "u-maya", "I opened for a similar bill at Brudenell last spring; solo and fast to soundcheck.", "accepted", 8),
    A("a-3", "l-4", "u-maya", "Based in Leeds, so no travel needed and I can bring a few friends.", "pending", 1),
    A("a-4", "l-p1", "u-maya", "Would love to play The Lantern Room again.", "accepted", 40),
    A("a-5", "l-p2", "u-maya", "Free that evening.", "accepted", 25),
    A("a-6", "l-3", "u-orchard", "Our quieter material suits a cellar bar.", "pending", 3),
  ];
  const bookings: Booking[] = [
    { id: "b-1", ref: "SS-4821", listingId: "l-2", applicationId: "a-2", artistId: "u-maya", promoterId: "u-north", feePence: 12000, status: "confirmed", createdAt: addDays(today, -6) + "T09:00:00Z" },
    { id: "b-2", ref: "SS-3170", listingId: "l-p1", applicationId: "a-4", artistId: "u-maya", promoterId: "u-harbour", feePence: 7500, status: "confirmed", createdAt: addDays(today, -35) + "T09:00:00Z" },
    { id: "b-3", ref: "SS-3388", listingId: "l-p2", applicationId: "a-5", artistId: "u-maya", promoterId: "u-north", feePence: 9000, status: "cancelled", createdAt: addDays(today, -22) + "T09:00:00Z",
      cancelledBy: "u-north", cancelReason: "Headliner pulled out; the show was called off.", cancelledAt: addDays(today, -14) + "T09:00:00Z" },
  ];
  return { users, listings, applications, bookings };
}
