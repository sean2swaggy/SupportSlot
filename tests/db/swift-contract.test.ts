import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createTestDb, type Db } from "./harness";

// The app is Swift and talks to PostgREST with table/column/function names in
// string literals, so a typo or a schema change would only show up on a phone.
// This test reads the Swift sources and checks every name it can see against
// the schema built from the real migrations:
//
//   - the column lists in `static let …Columns = "…"` (under a `// table: x`
//     tag) and in `Query("table", "…")`, including embedded `child(...)` lists,
//   - that every embed has exactly one foreign key between the two tables
//     (PostgREST refuses an ambiguous or missing relationship),
//   - filter/order columns on `Query("table")…` lines,
//   - the keys written by `insert` / `update` payloads,
//   - every `rpc("name", ["p_arg": …])`: the function exists, argument names
//     are real, required arguments are supplied, and the signed-in role may
//     execute it.
//
// It cannot see names built at run time (a payload passed through a variable is
// covered by the explicit REGIONS list below); anything it can't resolve is
// reported rather than silently skipped.

const SRC = path.resolve(__dirname, "../../SupportSlot/SupportSlot");

function swiftFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? swiftFiles(p) : e.name.endsWith(".swift") ? [p] : [];
  });
}
const files = swiftFiles(SRC).map((f) => ({ file: path.relative(SRC, f), text: fs.readFileSync(f, "utf8") }));
const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

let db: Db;
const columns = new Map<string, Set<string>>(); // table -> columns
const fks = new Map<string, number>(); // "a|b" (sorted) -> number of foreign keys
type Fn = { args: { name: string; required: boolean }[]; authenticated: boolean; anon: boolean };
const functions = new Map<string, Fn[]>();

beforeAll(async () => {
  db = await createTestDb();
  const cols = await db.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = 'public'`
  );
  for (const c of cols.rows) {
    if (!columns.has(c.table_name)) columns.set(c.table_name, new Set());
    columns.get(c.table_name)!.add(c.column_name);
  }
  const f = await db.query<{ a: string; b: string }>(
    `select ca.relname as a, cb.relname as b from pg_constraint k
       join pg_class ca on ca.oid = k.conrelid join pg_class cb on cb.oid = k.confrelid
       join pg_namespace n on n.oid = ca.relnamespace
      where k.contype = 'f' and n.nspname = 'public'`
  );
  for (const r of f.rows) {
    const key = [r.a, r.b].sort().join("|");
    fks.set(key, (fks.get(key) ?? 0) + 1);
  }
  const fn = await db.query<{ name: string; args: string; auth: boolean; anon: boolean }>(
    `select p.proname as name, pg_get_function_arguments(p.oid) as args,
            has_function_privilege('authenticated', p.oid, 'execute') as auth,
            has_function_privilege('anon', p.oid, 'execute') as anon
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`
  );
  for (const r of fn.rows) {
    const args: Fn["args"] = [];
    for (const part of splitTop(r.args)) {
      const p = part.trim();
      if (!p || /^OUT\s/i.test(p)) continue;
      const m = p.replace(/^(IN|INOUT|VARIADIC)\s+/i, "").match(/^"?([a-z_0-9]+)"?\s/i);
      if (m) args.push({ name: m[1], required: !/\sDEFAULT\s/i.test(p) });
    }
    if (!functions.has(r.name)) functions.set(r.name, []);
    functions.get(r.name)!.push({ args, authenticated: r.auth, anon: r.anon });
  }
});
afterAll(async () => {
  await db?.close();
});

/** Splits on commas that are not inside parentheses or quotes. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let quote = false;
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    if (!quote) {
      if (ch === "(" || ch === "[") depth++;
      if (ch === ")" || ch === "]") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur);
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// Column-constant resolution (`static let columns = "…\(Other.columns)…"`).
// ---------------------------------------------------------------------------
type Const = { key: string; table: string | null; raw: string; where: string };
const constants = new Map<string, Const>();
for (const { file, text } of files) {
  const typeDecls = [...text.matchAll(/^(?:struct|enum|extension|final class|class)\s+(\w+)/gm)];
  const tags = [...text.matchAll(/^\/\/ table: (\w+)/gm)];
  for (const m of text.matchAll(/static let (\w+) = "((?:[^"\\]|\\.)*)"/g)) {
    const idx = m.index!;
    const owner = [...typeDecls].filter((t) => t.index! < idx).pop()?.[1] ?? "";
    const tag = [...tags].filter((t) => t.index! < idx).pop();
    const table = tag && (!typeDecls.some((t) => t.index! > tag.index! && t.index! < idx) || true) ? tag[1] : null;
    constants.set(`${owner}.${m[1]}`, { key: `${owner}.${m[1]}`, table, raw: m[2], where: `${file}:${lineOf(text, idx)}` });
  }
}
function resolve(raw: string, owner: string, seen = new Set<string>()): string {
  return raw.replace(/\\\(([\w.]+)\)/g, (_, ref: string) => {
    const key = ref.includes(".") ? ref : `${owner}.${ref}`;
    const c = constants.get(key);
    if (!c) throw new Error(`cannot resolve \\(${ref}) (looked for ${key})`);
    if (seen.has(key)) throw new Error(`cycle through ${key}`);
    return resolve(c.raw, key.split(".")[0], new Set(seen).add(key));
  });
}

/** Checks a PostgREST select list against a table; returns a list of problems. */
function checkSelect(table: string, list: string, label: string): string[] {
  const problems: string[] = [];
  const cols = columns.get(table);
  if (!cols) return [`${label}: unknown table "${table}"`];
  for (const raw of splitTop(list)) {
    const item = raw.trim();
    if (!item || item === "*") continue;
    const embed = item.match(/^(?:\w+:)?(\w+)(?:!(\w+))?\((.*)\)$/s);
    if (embed) {
      const [, child, hint, inner] = embed;
      if (!columns.has(child)) {
        problems.push(`${label}: "${table}" embeds unknown table "${child}"`);
        continue;
      }
      const n = fks.get([table, child].sort().join("|")) ?? 0;
      if (n === 0) problems.push(`${label}: no foreign key between "${table}" and "${child}" to embed`);
      else if (n > 1 && !hint) problems.push(`${label}: ${n} foreign keys between "${table}" and "${child}" — embed is ambiguous without a hint`);
      problems.push(...checkSelect(child, inner, label));
    } else {
      const name = item.replace(/^\w+:/, "").replace(/::\w+$/, "");
      if (!/^[a-z_0-9]+$/.test(name)) problems.push(`${label}: cannot parse column "${item}"`);
      else if (!cols.has(name)) problems.push(`${label}: "${table}" has no column "${name}"`);
    }
  }
  return problems;
}

describe("Swift ↔ schema contract", () => {
  it("found the Swift sources", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(constants.size).toBeGreaterThan(20);
  });

  it("every `static let …Columns` list matches its table", () => {
    const problems: string[] = [];
    for (const c of constants.values()) {
      if (!/Columns$|^\w+\.columns$/.test(c.key.split(".")[1]) && c.key.split(".")[1] !== "columns") continue;
      if (!c.table) {
        problems.push(`${c.where}: ${c.key} has no "// table: x" tag above it`);
        continue;
      }
      try {
        problems.push(...checkSelect(c.table, resolve(c.raw, c.key.split(".")[0]), `${c.where} ${c.key}`));
      } catch (e) {
        problems.push(`${c.where} ${c.key}: ${(e as Error).message}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("every Query(table, columns) and its filters match the schema", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const { file, text } of files) {
      const owner = (idx: number) => [...text.matchAll(/^(?:struct|enum|extension|final class|class)\s+(\w+)/gm)].filter((t) => t.index! < idx).pop()?.[1] ?? "";
      for (const m of text.matchAll(/Query\("(\w+)"(?:,\s*("(?:[^"\\]|\\.)*"|[\w.]+))?\)((?:\.\w+\([^\n]*?\))*)/g)) {
        const [, table, arg, chain] = m;
        const label = `${file}:${lineOf(text, m.index!)} Query("${table}")`;
        checked++;
        if (!columns.has(table)) {
          problems.push(`${label}: unknown table`);
          continue;
        }
        if (arg) {
          try {
            const list = arg.startsWith('"') ? resolve(arg.slice(1, -1), owner(m.index!)) : resolve(`\\(${arg})`, owner(m.index!));
            problems.push(...checkSelect(table, list, label));
          } catch (e) {
            problems.push(`${label}: ${(e as Error).message}`);
          }
        }
        for (const f of chain.matchAll(/\.(eq|neq|gt|gte|lt|lte|ilike|isNull|contains|in|order)\("(\w+)"/g)) {
          if (!columns.get(table)!.has(f[2])) problems.push(`${label}: filter/order on missing column "${f[2]}"`);
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(problems).toEqual([]);
  });

  // Payloads built away from the call (a helper that returns a Patch). Each
  // entry names the region of source whose `"key":` literals go to one table.
  const REGIONS: { file: string; start: RegExp; end: RegExp; table: string }[] = [
    { file: "Backend/Actions.swift", start: /private func listingPayload/, end: /\n    }\n/, table: "slots" },
    { file: "Backend/Actions.swift", start: /payload\["promoter_id"\]/, end: /\n/, table: "slots" },
    { file: "Backend/ScheduleData.swift", start: /private func payload\(_ d: ScheduleEntryDraft\)/, end: /\n    }\n/, table: "schedule_entries" },
    { file: "Backend/ScheduleData.swift", start: /var p = payload\(d\); p\["schedule_id"\]/, end: /\n/, table: "schedule_entries" },
    { file: "Backend/ScheduleData.swift", start: /var p = payload\(e\); p\["schedule_id"\]/, end: /\n/, table: "schedule_entries" },
    { file: "Backend/ToolsData.swift", start: /var patch: Patch = \[/, end: /\n.*patch\["linked_application_id"\][^\n]*\n/, table: "gig_invitations" },
  ];

  it("every key written by insert/update payloads is a real column", () => {
    const problems: string[] = [];
    let checked = 0;
    // A key follows `[` or `,` (a ternary's `"a" : "b"` follows `?`).
    const keysIn = (s: string) => [...s.matchAll(/(?:^|[\[,]\s*)"([a-z_0-9]+)"\s*:/g)].map((k) => k[1]);
    const subscriptKeys = (s: string) => [...s.matchAll(/\b(?:p|payload|patch)\["([a-z_0-9]+)"\]\s*=/g)].map((k) => k[1]);

    for (const { file, text } of files) {
      const calls = [
        ...[...text.matchAll(/\b(?:insert|insertIgnoringDuplicates)\("(\w+)"/g)].map((m) => ({ table: m[1], index: m.index! })),
        ...[...text.matchAll(/\bupdate\(Query\("(\w+)"\)/g)].map((m) => ({ table: m[1], index: m.index! })),
      ];
      for (const c of calls) {
        const rest = text.slice(c.index);
        const lineEnd = rest.indexOf("\n");
        const patchAt = rest.indexOf("as Patch");
        // Literal payload: up to `as Patch`, but never past the end of the statement's function.
        const stop = rest.indexOf("\n    func ");
        const region = patchAt >= 0 && (stop < 0 || patchAt < stop) ? rest.slice(0, patchAt) : rest.slice(0, lineEnd);
        const label = `${file}:${lineOf(text, c.index)} write to "${c.table}"`;
        if (!columns.has(c.table)) {
          problems.push(`${label}: unknown table`);
          continue;
        }
        for (const k of keysIn(region)) {
          checked++;
          if (!columns.get(c.table)!.has(k)) problems.push(`${label}: no column "${k}"`);
        }
        const ret = rest.slice(Math.max(patchAt, 0), lineEnd > patchAt ? undefined : patchAt + 200).match(/returning:\s*("(?:[^"\\]|\\.)*"|[\w.]+)/);
        if (ret && patchAt >= 0 && patchAt < (stop < 0 ? Infinity : stop)) {
          const arg = ret[1];
          try {
            const list = arg.startsWith('"') ? arg.slice(1, -1) : resolve(`\\(${arg})`, "");
            problems.push(...checkSelect(c.table, list, `${label} returning`));
          } catch (e) {
            problems.push(`${label}: ${(e as Error).message}`);
          }
        }
      }
      for (const r of REGIONS.filter((x) => x.file === file)) {
        const s = text.search(r.start);
        if (s < 0) {
          problems.push(`${file}: payload region ${r.start} not found — update REGIONS in tests/db/swift-contract.test.ts`);
          continue;
        }
        const after = text.slice(s);
        const e = after.slice(1).search(r.end);
        const region = after.slice(0, e < 0 ? 400 : e + 1 + 60);
        for (const k of [...keysIn(region), ...subscriptKeys(region)]) {
          checked++;
          if (!columns.get(r.table)!.has(k)) problems.push(`${file} payload for "${r.table}": no column "${k}"`);
        }
      }
    }
    expect(checked).toBeGreaterThan(60);
    expect(problems).toEqual([]);
  });

  it("every rpc call names a real function with real arguments the user may call", () => {
    const problems: string[] = [];
    const unresolved: string[] = [];
    let checked = 0;
    for (const { file, text } of files) {
      for (const m of text.matchAll(/\brpc(?:Void|Raw)?(?:<[^>]*>)?\("(\w+)"/g)) {
        const name = m[1];
        const label = `${file}:${lineOf(text, m.index!)} rpc("${name}")`;
        const overloads = functions.get(name);
        checked++;
        if (!overloads) {
          problems.push(`${label}: no such function in the schema`);
          continue;
        }
        // Parameters: a dictionary literal right after the name, if any.
        const after = text.slice(m.index! + m[0].length);
        const open = after.match(/^\s*,\s*\[/);
        let keys: string[] | null = [];
        if (open) {
          let depth = 1;
          let i = open[0].length;
          while (i < after.length && depth > 0) {
            if (after[i] === "[") depth++;
            if (after[i] === "]") depth--;
            i++;
          }
          const body = after.slice(open[0].length, i - 1);
          keys = [...body.matchAll(/"([a-z_0-9]+)"\s*:/g)].map((k) => k[1]);
        } else if (/^\s*,/.test(after)) {
          keys = null; // parameters passed in a variable
          unresolved.push(label);
        }
        if (keys) {
          const ok = overloads.some(
            (o) => keys!.every((k) => o.args.some((a) => a.name === k)) && o.args.filter((a) => a.required).every((a) => keys!.includes(a.name))
          );
          if (!ok) {
            problems.push(
              `${label}: arguments (${keys.join(", ")}) don't match ${overloads.map((o) => `(${o.args.map((a) => a.name + (a.required ? "" : "?")).join(", ")})`).join(" or ")}`
            );
          }
        }
        if (!overloads.some((o) => o.authenticated)) problems.push(`${label}: signed-in users may not execute this function`);
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(problems).toEqual([]);
    // Calls whose arguments live in a variable can't be checked here; keep the list visible.
    if (unresolved.length) console.warn(`rpc calls with non-literal arguments (not checked):\n  ${unresolved.join("\n  ")}`);
  });

  it("functions the signed-out app calls are callable by anon", () => {
    const called = files.some(({ text }) => /\brpc(?:Void|Raw)?(?:<[^>]*>)?\("submit_support_request"/.test(text));
    expect(called).toBe(true);
    expect(functions.get("submit_support_request")!.some((o) => o.anon)).toBe(true);
  });
});
