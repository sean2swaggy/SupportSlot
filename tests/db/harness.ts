import { PGlite, type Transaction } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

// In-process Postgres (real Postgres, compiled to WASM) with just enough of
// Supabase stubbed — the auth.* helpers, the anon/authenticated/service_role
// roles and storage tables — to apply this project's REAL migrations
// unmodified and exercise row-level security, triggers and SQL functions
// exactly as Postgres would. It does not simulate PostgREST or GoTrue;
// anything crossing those boundaries is covered elsewhere (see
// scripts/security-regression.mjs for the live Supabase checks).

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create schema storage;
  grant usage on schema auth, storage to anon, authenticated, service_role;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}',
    email_confirmed_at timestamptz
  );

  -- Same lookup order Supabase's real auth.uid()/auth.role() use.
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
      'anon'
    )
  $$;

  -- auth.jwt() is what Supabase's RLS examples use to read claims such as
  -- the aal claim; same source as the real one (the request.jwt.claims setting).
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
  $$;

  create table storage.buckets (id text primary key, name text, public boolean default false);
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid
  );
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
  $$;

  -- Supabase's default privileges: the API roles can touch everything in
  -- public; row-level security (not grants) is what actually restricts them.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
`;

export type Db = PGlite;

export function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Fresh database with the Supabase stubs, then the real migrations in order.
 * `upTo` stops after a given file (used to test the upgrade of a project that
 * already holds data from the earlier migrations); `applyRest(db, after)`
 * applies the remaining ones.
 */
export async function createTestDb(opts: { upTo?: string } = {}): Promise<Db> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await applyMigrations(db, migrationFiles().filter((f) => !opts.upTo || f <= opts.upTo));
  return db;
}

export async function applyRest(db: Db, after: string): Promise<void> {
  await applyMigrations(db, migrationFiles().filter((f) => f > after));
}

async function applyMigrations(db: Db, files: string[]): Promise<void> {
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

let counter = 0;

/** Creates an auth user; the real handle_new_user() trigger builds the profile. */
export async function signUp(
  db: Db,
  role: "artist" | "promoter",
  opts: { email?: string } = {}
): Promise<string> {
  counter += 1;
  const email = opts.email ?? `${role}${counter}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const res = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
     values ($1, $2::jsonb, now()) returning id`,
    [email, JSON.stringify({ role })]
  );
  return res.rows[0].id;
}

/**
 * Runs `fn` as an authenticated API user (RLS applies, same as a browser or
 * route handler holding that user's JWT). Commits on success; a thrown error
 * rolls the transaction back and is re-thrown to the caller.
 */
export async function asUser<T>(
  db: Db,
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
  opts: { aal?: "aal1" | "aal2"; extraClaims?: Record<string, unknown> } = {}
): Promise<T> {
  // Default: a session that has completed the second factor (what the app
  // holds once signed in). Pass { aal: "aal1" } for a password-only session.
  const claims = { sub: userId, role: "authenticated", aal: opts.aal ?? "aal2", session_id: "test-session", ...opts.extraClaims };
  return db.transaction(async (tx) => {
    await tx.exec(`set local role authenticated`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await tx.query(`select set_config('request.jwt.claim.role', 'authenticated', true)`);
    return fn(tx);
  });
}

/** Runs `fn` as an unauthenticated (anon-key) API caller. */
export async function asAnon<T>(db: Db, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role anon`);
    await tx.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    await tx.query(`select set_config('request.jwt.claim.sub', '', true)`);
    await tx.query(`select set_config('request.jwt.claim.role', 'anon', true)`);
    return fn(tx);
  });
}

/** Runs `fn` with the service-role key — bypasses RLS, like the server's admin client. */
export async function asService<T>(db: Db, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role service_role`);
    await tx.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    await tx.query(`select set_config('request.jwt.claim.sub', '', true)`);
    await tx.query(`select set_config('request.jwt.claim.role', 'service_role', true)`);
    return fn(tx);
  });
}

// ---------------------------------------------------------------------------
// Fixtures — minimal valid rows, created as the service role so tests aren't
// coupled to onboarding code paths.
// ---------------------------------------------------------------------------

export interface PlaceFixture {
  label: string;
  country: "England" | "Scotland" | "Wales" | "Northern Ireland";
  region?: string | null;
  lat?: number;
  lon?: number;
}

/** Representative UK places across all four nations, incl. duplicate names. */
export const PLACES = {
  london: { label: "London", country: "England", region: "Greater London", lat: 51.5074, lon: -0.1278 },
  brighton: { label: "Brighton", country: "England", region: "East Sussex", lat: 50.8225, lon: -0.1372 },
  manchester: { label: "Manchester", country: "England", region: "Greater Manchester", lat: 53.4808, lon: -2.2426 },
  newportShropshire: { label: "Newport, Shropshire, England", country: "England", region: "Shropshire", lat: 52.7683, lon: -2.3774 },
  newportWales: { label: "Newport, Wales", country: "Wales", region: "Newport", lat: 51.5842, lon: -2.9977 },
  newportIoW: { label: "Newport, Isle of Wight, England", country: "England", region: "Isle of Wight", lat: 50.7007, lon: -1.2954 },
  edinburgh: { label: "Edinburgh, Scotland", country: "Scotland", region: "City of Edinburgh", lat: 55.9533, lon: -3.1883 },
  inverness: { label: "Inverness, Highland, Scotland", country: "Scotland", region: "Highland", lat: 57.4778, lon: -4.2247 },
  lerwick: { label: "Lerwick, Shetland, Scotland", country: "Scotland", region: "Shetland", lat: 60.1553, lon: -1.1457 },
  cardiff: { label: "Cardiff, Wales", country: "Wales", region: "Cardiff", lat: 51.4816, lon: -3.1791 },
  aberystwyth: { label: "Aberystwyth, Ceredigion, Wales", country: "Wales", region: "Ceredigion", lat: 52.4153, lon: -4.0829 },
  belfast: { label: "Belfast, Northern Ireland", country: "Northern Ireland", region: "Antrim", lat: 54.5973, lon: -5.9301 },
  derry: { label: "Derry, Northern Ireland", country: "Northern Ireland", region: null, lat: 54.9966, lon: -7.3086 },
  leeds: { label: "Leeds", country: "England", region: "West Yorkshire", lat: 53.8008, lon: -1.5491 },
  bristol: { label: "Bristol", country: "England", region: "Bristol", lat: 51.4545, lon: -2.5879 },
  stIves: { label: "St Ives, Cornwall, England", country: "England", region: "Cornwall", lat: 50.2108, lon: -5.4803 },
} satisfies Record<string, PlaceFixture>;

/**
 * Fictional artist. `place` (or a legacy label such as "Leeds") sets the public
 * label/country/region and the private, ~1 km-rounded coordinates, exactly as
 * set_my_location stores them; pass `noCoords: true` for a typed-in place.
 */
export async function makeArtist(
  db: Db,
  overrides: { handle?: string; name?: string; location?: string; place?: PlaceFixture; genres?: string[]; noCoords?: boolean } = {}
): Promise<string> {
  const id = await signUp(db, "artist");
  const byLabel = Object.values(PLACES).find((p) => p.label === overrides.location);
  const place: PlaceFixture = overrides.place ?? byLabel ?? (overrides.location
    ? { label: overrides.location, country: "England", region: null }
    : PLACES.london);
  await asService(db, async (tx) => {
    await tx.query(`update public.profiles set has_onboarded = true where id = $1`, [id]);
    await tx.query(
      `insert into public.artists (id, handle, name, location, location_country, location_region, location_source, genres)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, overrides.handle ?? `artist-${id.slice(0, 8)}`, overrides.name ?? "Test Artist", place.label, place.country,
       place.region ?? null, place.lat === undefined || overrides.noCoords ? "manual" : "search", overrides.genres ?? ["Indie"]]
    );
    if (place.lat !== undefined && !overrides.noCoords) {
      await tx.query(
        `insert into public.artist_locations (artist_id, lat, lon) values ($1, round($2::numeric, 2), round($3::numeric, 2))`,
        [id, place.lat, place.lon]
      );
    }
  });
  return id;
}

export async function makePromoter(db: Db): Promise<string> {
  const id = await signUp(db, "promoter");
  await asService(db, async (tx) => {
    await tx.query(`update public.profiles set has_onboarded = true where id = $1`, [id]);
    await tx.query(
      `insert into public.promoters (id, name, company, location, location_country, location_region)
       values ($1, 'Test Promoter', 'Test Co', 'London', 'England', 'Greater London')`,
      [id]
    );
  });
  return id;
}

let venueCounter = 0;
/** A venue in any place (created as the service role, like the curated ones). */
export async function makeVenue(db: Db, place: PlaceFixture, overrides: { name?: string; capacity?: number } = {}): Promise<string> {
  venueCounter += 1;
  const id = `test-venue-${venueCounter}-${Math.random().toString(36).slice(2, 6)}`;
  await asService(db, (tx) =>
    tx.query(
      `insert into public.venues (id, name, city, capacity, address, verification, country, region, lat, lon, location_source)
       values ($1, $2, $3, $4, '1 Test Street', 'unverified', $5, $6, $7, $8, $9)`,
      [id, overrides.name ?? `Venue ${venueCounter}`, place.label, overrides.capacity ?? 200, place.country, place.region ?? null,
       place.lat ?? null, place.lon ?? null, place.lat === undefined ? "manual" : "search"]
    )
  );
  return id;
}

export async function makeSlot(
  db: Db,
  promoterId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  // The listing's place always comes from its venue (a trigger copies it).
  const venueId = (overrides.venueId as string | undefined)
    ?? (overrides.place ? await makeVenue(db, overrides.place as PlaceFixture) : undefined);
  const res = await asService(db, async (tx) =>
    tx.query<{ id: string }>(
      `insert into public.slots
         (promoter_id, venue_id, headliner, date, doors_time, set_time,
          performance_length_mins, expected_attendance, support_fee, application_deadline, genres, travel_contribution)
       values ($1, coalesce($7, (select id from public.venues where id = 'venue-1')), $2, $3, '19:00', '20:00', 30, 200, $4, $5, $6, $8)
       returning id`,
      [
        promoterId,
        (overrides.headliner as string) ?? "Headliner",
        (overrides.date as string) ?? "2099-12-01",
        (overrides.supportFee as number) ?? 150,
        (overrides.deadline as string) ?? "2099-11-01",
        (overrides.genres as string[]) ?? ["Indie"],
        venueId ?? null,
        (overrides.travel as number) ?? 0,
      ]
    )
  );
  return res.rows[0].id;
}
