import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "./harness";
import * as queries from "../../src/lib/queries";
import { BOOKING_COLUMNS } from "../../src/lib/supabase/mappers";

// Static code can't tell us that `.select("a, b, c")` names real columns —
// TypeScript sees a string. A typo or a column that was renamed in a
// migration only shows up as a runtime error on a live page. This test reads
// every `.from("table")...select(...)`, `.insert({...})` and `.update({...})`
// in the source and checks each column against the real schema built from the
// migrations, so schema/code drift fails here instead.

let db: Db;
let columns: Map<string, Set<string>>;
let functions: Map<string, Set<string>>; // name -> argument names (any overload)

beforeAll(async () => {
  db = await createTestDb();
  const res = await db.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = 'public'`
  );
  const fns = await db.query<{ proname: string; proargnames: string[] | null }>(
    `select p.proname, p.proargnames from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`
  );
  functions = new Map();
  for (const f of fns.rows) {
    if (!functions.has(f.proname)) functions.set(f.proname, new Set());
    for (const a of f.proargnames ?? []) functions.get(f.proname)!.add(a);
  }
  columns = new Map();
  for (const r of res.rows) {
    if (!columns.has(r.table_name)) columns.set(r.table_name, new Set());
    columns.get(r.table_name)!.add(r.column_name);
  }
}, 60_000);
afterAll(async () => db.close());

const CONSTANTS: Record<string, string> = {
  ARTIST_COLUMNS: queries.ARTIST_COLUMNS,
  SLOT_COLUMNS: queries.SLOT_COLUMNS,
  SLOT_WITH_VENUE_COLUMNS: queries.SLOT_WITH_VENUE_COLUMNS,
  APPLICATION_COLUMNS: queries.APPLICATION_COLUMNS,
  BOOKING_COLUMNS,
  GIG_INVITATION_COLUMNS: queries.GIG_INVITATION_COLUMNS,
  SCHEDULE_ENTRY_COLUMNS: queries.SCHEDULE_ENTRY_COLUMNS,
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

// Split a PostgREST select list on top-level commas.
function splitTop(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

function checkSelect(table: string, list: string, where: string, problems: string[]) {
  const known = columns.get(table);
  if (!known) {
    problems.push(`${where}: unknown table "${table}"`);
    return;
  }
  for (const part of splitTop(list)) {
    if (part === "*") continue;
    const rel = part.match(/^(?:[a-z_]+:)?([a-z_]+)(?:!inner|![a-z_]+)?\(([\s\S]*)\)$/);
    if (rel) {
      checkSelect(rel[1], rel[2], where, problems);
      continue;
    }
    const col = part.replace(/^[a-z_]+:/, "");
    if (!known.has(col)) problems.push(`${where}: ${table}.${col} does not exist`);
  }
}

// Top-level keys of the object literal starting at `src[start] === "{"`.
function objectKeys(src: string, start: number): string[] {
  const keys: string[] = [];
  let depth = 0;
  let i = start;
  let segment = "";
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") {
      depth--;
      if (depth === 0) break;
    }
    if (depth === 1 && ch === ",") {
      const m = segment.match(/^\s*(?:\/\/.*\n\s*)*([A-Za-z_][A-Za-z0-9_]*)\s*(?::|$)/);
      if (m) keys.push(m[1]);
      segment = "";
    } else if (depth >= 1) segment += i === start ? "" : ch;
  }
  const m = segment.match(/^\s*(?:\/\/.*\n\s*)*([A-Za-z_][A-Za-z0-9_]*)\s*(?::|$)/);
  if (m) keys.push(m[1]);
  return keys;
}

describe("source queries match the migrated schema", () => {
  it("every select list, insert and update names real columns", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const file of walk(path.join(__dirname, "../../src"))) {
      const src = fs.readFileSync(file, "utf8");
      const rel = path.relative(path.join(__dirname, "../.."), file);
      const fromRe = /\.from\(\s*"([a-z_]+)"\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = fromRe.exec(src))) {
        const table = m[1];
        if (table.startsWith("storage")) continue;
        // One statement: from this `.from(` to the next semicolon.
        const end = src.indexOf(";", m.index);
        const window = src.slice(m.index, end === -1 ? m.index + 900 : end);
        const where = `${rel}`;

        const sel = window.match(/\.select\(\s*(?:"([^"]*)"|`([^`]*)`|([A-Z_]+))/);
        if (sel) {
          let list = sel[1] ?? sel[2] ?? CONSTANTS[sel[3]];
          if (list !== undefined) {
            list = list.replace(/\$\{([A-Z_]+)\}/g, (_, name: string) => {
              if (!(name in CONSTANTS)) throw new Error(`${rel}: unknown constant ${name} in select`);
              return CONSTANTS[name];
            });
            checkSelect(table, list, where, problems);
            checked++;
          }
        }
        for (const op of ["insert", "update", "upsert"]) {
          const i = window.indexOf(`.${op}(`);
          if (i === -1) continue;
          const brace = window.indexOf("{", i);
          if (brace === -1 || brace - i > 12) continue; // a variable, not a literal
          const absolute = m.index + brace;
          for (const key of objectKeys(src, absolute)) {
            if (!columns.get(table)?.has(key)) problems.push(`${where}: ${op} ${table}.${key} does not exist`);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
    expect(problems).toEqual([]);
  });
});

describe("source RPC calls match the migrated functions", () => {
  it("every rpc() names a real function and real argument names", () => {
    const problems: string[] = [];
    let checked = 0;
    const re = /(?:\brpc(?:<[^>]*>)?\(\s*(?:[A-Za-z_]+,\s*)?|\bcall\(\s*deps,\s*)"([a-z_]+)"/g;
    for (const file of walk(path.join(__dirname, "../../src"))) {
      const src = fs.readFileSync(file, "utf8");
      const rel = path.relative(path.join(__dirname, "../.."), file);
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const fn = m[1];
        const known = functions.get(fn);
        if (!known) {
          problems.push(`${rel}: function ${fn}() does not exist`);
          continue;
        }
        checked++;
        const after = src.slice(m.index + m[0].length, m.index + m[0].length + 6);
        const comma = after.match(/^\s*,\s*\{/);
        if (comma) {
          const brace = src.indexOf("{", m.index + m[0].length);
          for (const key of objectKeys(src, brace)) {
            if (!known.has(key)) problems.push(`${rel}: ${fn}(${key}) is not an argument`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });
});
