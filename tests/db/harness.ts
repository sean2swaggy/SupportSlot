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

export async function createTestDb(): Promise<Db> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const file of migrationFiles()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return db;
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
export async function asUser<T>(db: Db, userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role authenticated`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await tx.query(`select set_config('request.jwt.claim.role', 'authenticated', true)`);
    return fn(tx);
  });
}

/** Runs `fn` as an unauthenticated (anon-key) API caller. */
export async function asAnon<T>(db: Db, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role anon`);
    await tx.query(`select set_config('request.jwt.claim.sub', '', true)`);
    await tx.query(`select set_config('request.jwt.claim.role', 'anon', true)`);
    return fn(tx);
  });
}

/** Runs `fn` with the service-role key — bypasses RLS, like the server's admin client. */
export async function asService<T>(db: Db, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role service_role`);
    await tx.query(`select set_config('request.jwt.claim.sub', '', true)`);
    await tx.query(`select set_config('request.jwt.claim.role', 'service_role', true)`);
    return fn(tx);
  });
}

// ---------------------------------------------------------------------------
// Fixtures — minimal valid rows, created as the service role so tests aren't
// coupled to onboarding code paths.
// ---------------------------------------------------------------------------

export async function makeArtist(db: Db, overrides: Record<string, unknown> = {}): Promise<string> {
  const id = await signUp(db, "artist");
  await asService(db, async (tx) => {
    await tx.query(`update public.profiles set has_onboarded = true where id = $1`, [id]);
    await tx.query(
      `insert into public.artists (id, handle, name, location, genres)
       values ($1, $2, $3, $4, $5)`,
      [
        id,
        (overrides.handle as string) ?? `artist-${id.slice(0, 8)}`,
        (overrides.name as string) ?? "Test Artist",
        (overrides.location as string) ?? "London",
        (overrides.genres as string[]) ?? ["Indie"],
      ]
    );
  });
  return id;
}

export async function makePromoter(db: Db): Promise<string> {
  const id = await signUp(db, "promoter");
  await asService(db, async (tx) => {
    await tx.query(`update public.profiles set has_onboarded = true where id = $1`, [id]);
    await tx.query(
      `insert into public.promoters (id, name, company, location) values ($1, 'Test Promoter', 'Test Co', 'London')`,
      [id]
    );
  });
  return id;
}

export async function makeSlot(
  db: Db,
  promoterId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const res = await asService(db, async (tx) =>
    tx.query<{ id: string }>(
      `insert into public.slots
         (promoter_id, venue_id, headliner, city, date, doors_time, set_time,
          performance_length_mins, expected_attendance, support_fee, application_deadline, genres)
       values ($1, (select id from public.venues limit 1), $2, $3, $4, '19:00', '20:00', 30, 200, $5, $6, $7)
       returning id`,
      [
        promoterId,
        (overrides.headliner as string) ?? "Headliner",
        (overrides.city as string) ?? "London",
        (overrides.date as string) ?? "2099-12-01",
        (overrides.supportFee as number) ?? 150,
        (overrides.deadline as string) ?? "2099-11-01",
        (overrides.genres as string[]) ?? ["Indie"],
      ]
    )
  );
  return res.rows[0].id;
}
