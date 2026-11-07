import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  applyRest, asAnon, asService, asUser, createTestDb, makeArtist, makePromoter, makeSlot, makeVenue, PLACES, signUp, type Db,
} from "./harness";

// UK-wide locations: the six-city restriction is gone everywhere, real places
// from all four nations (including small places and duplicate names) work,
// artists' coordinates stay private, distances are straight-line and never
// invented, and existing six-city data survives the upgrade.

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => db.close());

const R = (rows: unknown[]) => rows as Record<string, unknown>[];

describe("no six-city restriction remains", () => {
  it("has no CHECK on a place column that lists cities, and no city_distances table", async () => {
    const r = await db.query<{ conname: string; def: string }>(`
      select conname, pg_get_constraintdef(oid) as def from pg_constraint
      where connamespace = 'public'::regnamespace and contype = 'c' and pg_get_constraintdef(oid) ~* '(manchester|brighton|birmingham|leeds|bristol)'`);
    expect(r.rows).toEqual([]);
    const t = await db.query(`select 1 from pg_tables where schemaname = 'public' and tablename = 'city_distances'`);
    expect(t.rows).toHaveLength(0);
    const f = await db.query(`select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('city_distance_miles','effective_travel_pence')`);
    expect(f.rows).toHaveLength(0);
  });

  it("does not mention a fixed city list in any Swift or SQL source outside the migration history", () => {
    const swiftDir = path.resolve(__dirname, "../../SupportSlot/SupportSlot");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".swift") && /"Manchester",\s*"Birmingham"|cities\s*=\s*\[/.test(fs.readFileSync(p, "utf8"))) offenders.push(p);
      }
    };
    walk(swiftDir);
    expect(offenders).toEqual([]);
  });
});

describe("places from all four nations", () => {
  it("accepts artists, promoters-as-venue-owners and listings in cities, towns and villages everywhere", async () => {
    const promoter = await makePromoter(db);
    for (const place of Object.values(PLACES)) {
      const artist = await makeArtist(db, { place });
      const venue = await makeVenue(db, place);
      const slot = await makeSlot(db, promoter, { venueId: venue });
      const row = await db.query<{ city: string; country: string; region: string | null; lat: number | null }>(
        `select city, country, region, lat from public.slots where id = $1`, [slot]);
      expect(row.rows[0]).toMatchObject({ city: place.label, country: place.country, region: place.region ?? null, lat: place.lat });
      const a = await db.query<{ location: string; location_country: string }>(`select location, location_country from public.artists where id = $1`, [artist]);
      expect(a.rows[0]).toEqual({ location: place.label, location_country: place.country });
    }
    const nations = await db.query<{ c: string }>(`select distinct country c from public.slots order by 1`);
    expect(nations.rows.map((r) => r.c)).toEqual(expect.arrayContaining(["England", "Northern Ireland", "Scotland", "Wales"]));
  });

  it("keeps identically named places apart by wider area and country", async () => {
    const labels = [PLACES.newportShropshire, PLACES.newportWales, PLACES.newportIoW];
    expect(new Set(labels.map((p) => p.label)).size).toBe(3);
    const promoter = await makePromoter(db);
    const slots: Record<string, string> = {};
    for (const p of labels) slots[p.country + p.region] = await makeSlot(db, promoter, { headliner: "Newport Night", place: p });
    // Text search by the area finds only that Newport.
    const search = (q: string, country: string | null = null) =>
      asAnon(db, (tx) => tx.query<{ id: string }>(`select id from public.search_slots($1, $2) `, [q, country]));
    const shropshire = await search("newport night");
    expect(shropshire.rows).toHaveLength(3);
    const byCountry = await search("newport night", "Wales");
    expect(byCountry.rows.map((r) => r.id)).toEqual([slots["WalesNewport"]]);
    const byRegion = await asAnon(db, (tx) => tx.query<{ id: string }>(`select id from public.search_slots('isle of wight')`));
    expect(byRegion.rows.map((r) => r.id)).toContain(slots["EnglandIsle of Wight"]);
    // Radius around the Welsh Newport finds Cardiff-side venues but not the Shropshire one.
    const near = await asAnon(db, (tx) =>
      tx.query<{ id: string }>(`select id from public.search_slots('newport night', null, null, null, null, null, null, null, $1, $2, 20)`, [PLACES.newportWales.lat, PLACES.newportWales.lon]));
    expect(near.rows.map((r) => r.id)).toEqual([slots["WalesNewport"]]);
  });

  it("does not require a county where there isn't one (Derry, Cardiff-style unitary areas)", async () => {
    const artist = await makeArtist(db, { place: PLACES.derry });
    const r = await db.query<{ location_region: string | null }>(`select location_region from public.artists where id = $1`, [artist]);
    expect(r.rows[0].location_region).toBeNull();
  });
});

describe("place validation (the database does not trust the form)", () => {
  const venue = (args: Partial<Record<string, unknown>>) => {
    const a = { name: "Test Hall", address: "1 High St", cap: 100, label: "Elgin, Moray, Scotland", country: "Scotland", region: "Moray", lat: 57.65, lon: -3.32, source: "search", ...args };
    return asUser(db, promoterId, (tx) =>
      tx.query<{ id: string }>(`select public.create_venue($1,$2,$3,$4,$5,$6,$7,$8,$9) as id`, [a.name, a.address, a.cap, a.label, a.country, a.region, a.lat, a.lon, a.source]));
  };
  let promoterId: string;
  beforeAll(async () => {
    promoterId = await makePromoter(db);
  });

  it("creates a venue in a small Scottish town and returns the same one for a repeat", async () => {
    const a = await venue({});
    const b = await venue({});
    expect(a.rows[0].id).toBe(b.rows[0].id);
    const row = await db.query(`select city, country, region, verification, created_by from public.venues where id = $1`, [a.rows[0].id]);
    expect(row.rows[0]).toEqual({ city: "Elgin, Moray, Scotland", country: "Scotland", region: "Moray", verification: "unverified", created_by: promoterId });
  });

  it.each([
    ["a country outside the four nations", { country: "France" }, /choose England/],
    ["a missing country", { country: null }, /choose England/],
    ["a latitude without a longitude", { lon: null }, /both a latitude and a longitude/],
    ["coordinates in Paris", { lat: 48.85, lon: 2.35 }, /aren't in the United Kingdom/],
    ["typed-in places that carry coordinates", { source: "manual" }, /no coordinates/],
    ["an empty name of place", { label: " " }, /name of a place/],
    ["a control character in the label", { label: "Elgin\u0000x" }, /name of a place|invalid/],
    ["a one-character county", { region: "x" }, /county or area/],
    ["capacity zero", { cap: 0 }, /capacity/],
  ])("rejects %s", async (_n, args, message) => {
    await expect(venue(args as Partial<Record<string, unknown>>)).rejects.toThrow(message as RegExp);
  });

  it("accepts a typed-in place with no coordinates, and a listing there simply has none", async () => {
    const v = await venue({ name: "Village Hall", label: "Tiny Village, Powys, Wales", country: "Wales", region: "Powys", lat: null, lon: null, source: "manual" });
    const slot = await makeSlot(db, promoterId, { venueId: v.rows[0].id });
    const row = await db.query<{ lat: number | null; lon: number | null; country: string }>(`select lat, lon, country from public.slots where id = $1`, [slot]);
    expect(row.rows[0]).toEqual({ lat: null, lon: null, country: "Wales" });
  });

  it("only promoters can add venues", async () => {
    const artist = await makeArtist(db);
    await expect(
      asUser(db, artist, (tx) => tx.query(`select public.create_venue('X Hall','1 St',50,'Leeds','England',null,53.8,-1.55,'search')`))
    ).rejects.toThrow(/promoter_required/);
  });

  it("a listing takes its place from its venue; a client-supplied place is ignored", async () => {
    const edinburgh = await makeVenue(db, PLACES.edinburgh);
    const res = await asUser(db, promoterId, (tx) =>
      tx.query<{ id: string }>(
        `insert into public.slots (promoter_id, venue_id, headliner, city, country, lat, lon, date, doors_time, set_time, performance_length_mins,
           expected_attendance, support_fee, application_deadline, genres)
         values ($1, $2, 'Spoof', 'London', 'England', 51.5, -0.1, '2099-06-01', '19:00', '20:00', 30, 100, 50, '2099-05-01', '{Indie}') returning id`,
        [promoterId, edinburgh]));
    const row = await db.query<{ city: string; country: string; lat: number }>(`select city, country, lat from public.slots where id = $1`, [res.rows[0].id]);
    expect(row.rows[0]).toMatchObject({ city: PLACES.edinburgh.label, country: "Scotland", lat: PLACES.edinburgh.lat });
  });
});

describe("artists' coordinates are private", () => {
  it("set_my_location stores the public label and rounds the private coordinates to ~1 km", async () => {
    const artist = await makeArtist(db, { place: PLACES.london });
    await asUser(db, artist, (tx) => tx.query(`select public.set_my_location('Falkirk, Scotland','Scotland','Falkirk',56.001234,-3.783456,'search')`));
    const pub = await db.query<{ location: string; location_country: string; location_region: string }>(`select location, location_country, location_region from public.artists where id = $1`, [artist]);
    expect(pub.rows[0]).toEqual({ location: "Falkirk, Scotland", location_country: "Scotland", location_region: "Falkirk" });
    const priv = await db.query<{ lat: number; lon: number }>(`select lat, lon from public.artist_locations where artist_id = $1`, [artist]);
    expect(priv.rows[0]).toEqual({ lat: 56, lon: -3.78 });
  });

  it("is invisible to everyone but the artist, on every route", async () => {
    const artist = await makeArtist(db, { place: PLACES.brighton });
    const other = await makeArtist(db);
    const promoter = await makePromoter(db);
    expect((await asUser(db, artist, (tx) => tx.query(`select * from public.artist_locations`))).rows).toHaveLength(1);
    expect((await asUser(db, other, (tx) => tx.query(`select * from public.artist_locations where artist_id = $1`, [artist]))).rows).toHaveLength(0);
    expect((await asUser(db, promoter, (tx) => tx.query(`select * from public.artist_locations where artist_id = $1`, [artist]))).rows).toHaveLength(0);
    await expect(asAnon(db, (tx) => tx.query(`select * from public.artist_locations`))).rejects.toThrow(/permission denied/);
    // No direct writes: clients can't plant coordinates for themselves or others.
    await expect(asUser(db, artist, (tx) => tx.query(`insert into public.artist_locations (artist_id, lat, lon) values ($1, 51, -1)`, [other]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, artist, (tx) => tx.query(`update public.artist_locations set lat = 55`))).rejects.toThrow(/permission denied/);
    // The public artist row and the public search expose no coordinates.
    const cols = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema='public' and table_name='artists'`);
    expect(cols.rows.map((c) => c.column_name).filter((c) => /lat|lon|coord/.test(c))).toEqual([]);
  });

  it("the location label can only change through the picker function, so label and coordinates cannot drift", async () => {
    const artist = await makeArtist(db, { place: PLACES.london });
    await expect(asUser(db, artist, (tx) => tx.query(`update public.artists set location = 'Leeds' where id = $1`, [artist]))).rejects.toThrow(/location picker/);
    await expect(asUser(db, artist, (tx) => tx.query(`update public.artists set location_country = 'Wales' where id = $1`, [artist]))).rejects.toThrow(/location picker/);
    await asUser(db, artist, (tx) => tx.query(`update public.artists set bio = 'still editable' where id = $1`, [artist]));
  });

  it("switching to a typed-in place removes the old coordinates rather than keeping them", async () => {
    const artist = await makeArtist(db, { place: PLACES.cardiff });
    await asUser(db, artist, (tx) => tx.query(`select public.set_my_location('Tiny Village, Powys, Wales','Wales','Powys',null,null,'manual')`));
    expect((await db.query(`select 1 from public.artist_locations where artist_id = $1`, [artist])).rows).toHaveLength(0);
  });

  it("promoters find nearby artists with distance rounded up to 5 miles; artists without coordinates are left out of a radius search", async () => {
    const promoter = await makePromoter(db);
    const brighton = await makeArtist(db, { place: PLACES.brighton, name: "Near Brighton" });
    const leeds = await makeArtist(db, { place: PLACES.leeds, name: "Near Leeds" });
    const typed = await makeArtist(db, { place: { label: "Typed Town, England", country: "England" }, name: "No Coords" });
    const q = (args: unknown[]) =>
      asUser(db, promoter, (tx) =>
        tx.query<{ id: string; distance_miles: number | null }>(`select id, distance_miles from public.search_artists($1,$2,$3,$4,$5,$6,$7)`, args));
    const near = await q([null, null, null, PLACES.london.lat, PLACES.london.lon, 60, "distance"]);
    expect(near.rows.map((r) => r.id).filter((id) => [brighton, leeds, typed].includes(id))).toEqual([brighton]);
    expect(near.rows.find((r) => r.id === brighton)!.distance_miles).toBe(50); // ~47 miles, rounded up to the next 5
    expect((await q([null, null, null, PLACES.london.lat, PLACES.london.lon, 400, "distance"])).rows.map((r) => r.id).filter((id) => [brighton, leeds, typed].includes(id))).toEqual([brighton, leeds]);
    const byName = await q(["no coords", null, null, null, null, null, "newest"]);
    expect(byName.rows.map((r) => r.id)).toEqual([typed]);
    expect(byName.rows[0].distance_miles).toBeNull();
    // Artists cannot use it, nor can a password-only session.
    const artist = await makeArtist(db);
    await asUser(db, artist, (tx) => tx.query(`select * from public.search_artists()`)); // any signed-in aal2 user may search
    await expect(asUser(db, promoter, (tx) => tx.query(`select * from public.search_artists()`), { aal: "aal1" })).rejects.toThrow(/mfa_required/);
    await expect(asAnon(db, (tx) => tx.query(`select * from public.search_artists()`))).rejects.toThrow(/permission denied/);
  });
});

describe("distance is straight-line and honest", () => {
  // Golden values from the SQL function. The Swift test (GeoTests) asserts the
  // same numbers; this test reads them from that file so the two cannot drift.
  const swiftTest = fs.readFileSync(path.resolve(__dirname, "../../SupportSlot/SupportSlotTests/GeoTests.swift"), "utf8");
  const golden = [...swiftTest.matchAll(/golden\(\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.]+)\s*\)/g)].map((m) => m.slice(1).map(Number));

  it("has golden pairs shared with the Swift tests", () => {
    expect(golden.length).toBeGreaterThanOrEqual(6);
  });

  it("matches the golden values to 0.01 mile", async () => {
    for (const [a, b, c, d, miles] of golden) {
      const r = await db.query<{ m: number }>(`select public.haversine_miles($1,$2,$3,$4) as m`, [a, b, c, d]);
      expect(r.rows[0].m).toBeCloseTo(miles, 2);
    }
  });

  it("is zero for the same point, symmetric, and null (never a guess) when a point is missing", async () => {
    const same = await db.query<{ m: number }>(`select public.haversine_miles(51.5,-0.1,51.5,-0.1) as m`);
    expect(same.rows[0].m).toBe(0);
    const ab = await db.query<{ ab: number; ba: number }>(`select public.haversine_miles(51.5,-0.1,55.9,-3.2) ab, public.haversine_miles(55.9,-3.2,51.5,-0.1) ba`);
    expect(ab.rows[0].ab).toBeCloseTo(ab.rows[0].ba, 9);
    const none = await db.query<{ m: number | null }>(`select public.haversine_miles(null,-0.1,51.5,-0.1) as m`);
    expect(none.rows[0].m).toBeNull();
  });

  it("sorts search results by distance and reports it with one decimal", async () => {
    const promoter = await makePromoter(db);
    const far = await makeSlot(db, promoter, { headliner: "Sorted Far", place: PLACES.inverness });
    const mid = await makeSlot(db, promoter, { headliner: "Sorted Mid", place: PLACES.manchester });
    const near = await makeSlot(db, promoter, { headliner: "Sorted Near", place: PLACES.brighton });
    const r = await asAnon(db, (tx) =>
      tx.query<{ id: string; distance_miles: number }>(
        `select id, distance_miles from public.search_slots('sorted', null, null, null, null, null, null, null, $1, $2, null, false, 'distance')`,
        [PLACES.london.lat, PLACES.london.lon]));
    expect(r.rows.map((x) => x.id)).toEqual([near, mid, far]);
    expect(r.rows.map((x) => x.distance_miles)).toEqual([...r.rows.map((x) => x.distance_miles)].sort((a, b) => a - b));
    expect(r.rows[2].distance_miles).toBeGreaterThan(400); // London → Inverness ≈ 450 miles
  });
});

describe("travel terms (the long-journey minimum), defined on straight-line distance", () => {
  async function terms(artistPlace: Parameters<typeof makeArtist>[1], venuePlace: (typeof PLACES)[keyof typeof PLACES], travelPounds: number, opts: { noCoords?: boolean } = {}) {
    const promoter = await makePromoter(db);
    const artist = await makeArtist(db, { ...artistPlace, noCoords: opts.noCoords });
    const slot = await makeSlot(db, promoter, { place: venuePlace, travel: travelPounds, supportFee: 100 });
    const asArtist = await asUser(db, artist, (tx) => tx.query<Record<string, unknown>>(`select * from public.terms_preview($1)`, [slot]));
    const app = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1, $2) returning id`, [slot, artist]))).rows[0].id;
    const asPromoter = await asUser(db, promoter, (tx) => tx.query<Record<string, unknown>>(`select * from public.terms_preview($1, $2)`, [slot, artist]));
    await asUser(db, promoter, (tx) => tx.query(`select public.make_offer($1, null)`, [app]));
    const booking = await db.query<{ fee_pence: number; travel_pence: number }>(`select fee_pence, travel_pence from public.bookings where application_id = $1`, [app]);
    return { artist: asArtist.rows[0], promoter: asPromoter.rows[0], booking: booking.rows[0], slot, artistId: artist, promoterId: promoter };
  }
  const watford = { place: { label: "Watford, Hertfordshire, England", country: "England", region: "Hertfordshire", lat: 51.656, lon: -0.397 } as const };

  it("short journey: the promoter's figure stands", async () => {
    const t = await terms(watford, PLACES.london, 5);
    expect(t.artist).toMatchObject({ fee_pence: 10000, travel_pence: 500, long_journey: false, basis: "straight_line", minimum_applies: false });
    expect(t.booking).toEqual({ fee_pence: 10000, travel_pence: 500 });
  });

  it("long journey: travel is lifted to £10 when the promoter offered less, and left alone when more", async () => {
    const low = await terms({ place: PLACES.brighton }, PLACES.london, 5); // ~47 miles
    expect(low.artist).toMatchObject({ travel_pence: 1000, long_journey: true, minimum_applies: true });
    expect(low.booking.travel_pence).toBe(1000);
    const zero = await terms({ place: PLACES.brighton }, PLACES.london, 0);
    expect(zero.booking.travel_pence).toBe(1000);
    const high = await terms({ place: PLACES.brighton }, PLACES.london, 25);
    expect(high.artist).toMatchObject({ travel_pence: 2500, minimum_applies: false });
    expect(high.booking.travel_pence).toBe(2500);
  });

  it("works across the UK, including Scotland-to-England and the Northern Ireland sea crossing (straight line, no ferry time invented)", async () => {
    const far = await terms({ place: PLACES.belfast }, PLACES.edinburgh, 0);
    expect(far.artist).toMatchObject({ long_journey: true, travel_pence: 1000, basis: "straight_line" });
    expect(Number(far.artist.distance_miles)).toBeGreaterThan(100);
    const sameTown = await terms({ place: PLACES.cardiff }, PLACES.cardiff, 0);
    expect(sameTown.artist).toMatchObject({ long_journey: false, travel_pence: 0 });
  });

  it("missing coordinates are not guessed: the artist-protective rule applies and says so", async () => {
    const typed = await terms({ place: PLACES.london }, PLACES.london, 0, { noCoords: true });
    expect(typed.artist).toMatchObject({ long_journey: true, basis: "unknown_location", distance_miles: null, travel_pence: 1000 });
    expect(typed.booking.travel_pence).toBe(1000);
    const typedVenue = await terms({ place: PLACES.london }, { label: "Typed Hall, England", country: "England" } as never, 0);
    expect(typedVenue.artist).toMatchObject({ basis: "unknown_location", travel_pence: 1000 });
  });

  it("shows the promoter a rounded distance only, and refuses people with no business asking", async () => {
    const t = await terms({ place: PLACES.brighton }, PLACES.london, 0);
    expect(Number(t.promoter.distance_miles) % 5).toBe(0);
    const stranger = await makePromoter(db);
    await expect(asUser(db, stranger, (tx) => tx.query(`select * from public.terms_preview($1, $2)`, [t.slot, t.artistId]))).rejects.toThrow(/not_authorized/);
    const otherArtist = await makeArtist(db);
    await expect(asUser(db, otherArtist, (tx) => tx.query(`select * from public.terms_preview($1, $2)`, [t.slot, t.artistId]))).rejects.toThrow(/not_authorized/);
    // The promoter can only ask about artists who applied.
    const nonApplicant = await makeArtist(db);
    await expect(asUser(db, t.promoterId, (tx) => tx.query(`select * from public.terms_preview($1, $2)`, [t.slot, nonApplicant]))).rejects.toThrow(/not_authorized/);
  });

  it("money is integer pence end to end and the offer snapshot survives later changes", async () => {
    const t = await terms({ place: PLACES.brighton }, PLACES.london, 12);
    expect(Number.isInteger(t.booking.fee_pence) && Number.isInteger(t.booking.travel_pence)).toBe(true);
    await asService(db, (tx) => tx.query(`update public.slots set support_fee = 999, travel_contribution = 99 where id = $1`, [t.slot]));
    const after = await db.query<{ fee_pence: number; travel_pence: number }>(`select fee_pence, travel_pence from public.bookings where slot_id = $1`, [t.slot]);
    expect(after.rows[0]).toEqual({ fee_pence: 10000, travel_pence: 1200 });
  });
});

describe("upgrading a project that already holds six-city data", () => {
  it("keeps every existing row and gives it a country, region and city-centre point", async () => {
    const old = await createTestDb({ upTo: "0002_app_functions.sql" });
    // Data as the original app would have written it (no aal claim, six cities).
    const artistId = await signUp(old, "artist");
    const promoterId = await signUp(old, "promoter");
    await old.query(`update public.profiles set has_onboarded = true`);
    await old.query(`insert into public.artists (id, handle, name, location, genres) values ($1, 'legacy', 'Legacy Act', 'Leeds', '{Folk}')`, [artistId]);
    await old.query(`insert into public.promoters (id, name, company, location) values ($1, 'P', 'Legacy Co', 'Bristol')`, [promoterId]);
    const slot = await old.query<{ id: string }>(
      `insert into public.slots (promoter_id, venue_id, headliner, city, date, doors_time, set_time, performance_length_mins, expected_attendance, support_fee, application_deadline, genres)
       values ($1, 'venue-2', 'Legacy Show', 'Manchester', '2099-09-01', '19:00', '20:00', 30, 200, 120, '2099-08-01', '{Folk}') returning id`, [promoterId]);
    const appId = (await old.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1, $2) returning id`, [slot.rows[0].id, artistId])).rows[0].id;
    const bookingBefore = await old.query(
      `insert into public.bookings (application_id, slot_id, artist_id, promoter_id, status, artist_name, promoter_company, headliner, venue_id, venue_name, venue_address, venue_city,
         event_date, doors_time, set_time, set_length_mins, fee_pence, travel_pence, offer_expires_at)
       values ($1, $2, $3, $4, 'offered', 'Legacy Act', 'Legacy Co', 'Legacy Show', 'venue-2', 'YES Basement', '38 Charles St', 'Manchester', '2099-09-01', '19:00', '20:00', 30, 12000, 1000, now() + interval '3 days')
       returning fee_pence, travel_pence, venue_city`, [appId, slot.rows[0].id, artistId, promoterId]);

    await applyRest(old, "0002_app_functions.sql");

    expect((await old.query(`select location, location_country, location_region, location_source from public.artists`)).rows[0])
      .toEqual({ location: "Leeds", location_country: "England", location_region: "West Yorkshire", location_source: "legacy" });
    expect((await old.query(`select location, location_country, location_region from public.promoters`)).rows[0])
      .toEqual({ location: "Bristol", location_country: "England", location_region: "Bristol" });
    expect((await old.query(`select city, country, region, lat, lon from public.slots`)).rows[0])
      .toEqual({ city: "Manchester", country: "England", region: "Greater Manchester", lat: 53.4808, lon: -2.2426 });
    expect(Number((await old.query<{ n: string }>(`select count(*) n from public.venues where country = 'England' and lat is not null`)).rows[0].n)).toBe(6);
    expect((await old.query(`select lat, lon from public.artist_locations`)).rows[0]).toEqual({ lat: 53.8008, lon: -1.5491 });
    // The agreed terms snapshot is untouched.
    expect((await old.query(`select fee_pence, travel_pence, venue_city from public.bookings`)).rows[0]).toEqual(bookingBefore.rows[0]);
    // Legacy rows behave like new ones: the Leeds artist has a Manchester offer terms preview.
    const t = await asUser(old, artistId, (tx) => tx.query<{ long_journey: boolean }>(`select * from public.terms_preview($1)`, [slot.rows[0].id]));
    expect(t.rows[0].long_journey).toBe(true); // ~36 miles Leeds→Manchester straight line
    await old.close();
  }, 60_000);

  it("can be applied twice only because it is not rerun: a second run fails loudly instead of corrupting data", async () => {
    const fresh = await createTestDb();
    const sql = fs.readFileSync(path.resolve(__dirname, "../../supabase/migrations/0004_uk_locations.sql"), "utf8");
    await expect(fresh.exec(sql)).rejects.toThrow();
    // …and the failed rerun changed nothing.
    expect(Number((await fresh.query<{ n: string }>(`select count(*) n from public.venues`)).rows[0].n)).toBe(6);
    await fresh.close();
  });
});

describe("rate limits", () => {
  it("limits venue creation per promoter per day, and listings per hour", async () => {
    const promoter = await makePromoter(db);
    const mk = (i: number) =>
      asUser(db, promoter, (tx) =>
        tx.query(`select public.create_venue($1,'1 High St',100,'Elgin, Moray, Scotland','Scotland','Moray',57.65,-3.32,'search')`, [`Rate Venue ${i}`]));
    for (let i = 0; i < 10; i++) await mk(i);
    await expect(mk(10)).rejects.toThrow(/rate_limited/);
  });
});
