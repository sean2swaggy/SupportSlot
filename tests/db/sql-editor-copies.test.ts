import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../supabase");

describe("supabase/sql-editor", () => {
  it("holds a byte-for-byte copy of every migration, and nothing else SQL", () => {
    const migrations = fs.readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort();
    const copies = fs.readdirSync(path.join(root, "sql-editor")).filter((f) => f.endsWith(".sql")).sort();
    expect(copies).toEqual(migrations);
    for (const f of migrations) {
      expect(fs.readFileSync(path.join(root, "sql-editor", f), "utf8"), f).toBe(fs.readFileSync(path.join(root, "migrations", f), "utf8"));
    }
  });
});
