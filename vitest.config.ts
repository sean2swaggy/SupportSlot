import { defineConfig } from "vitest/config";

// Database tests only: the real schema (supabase/migrations) runs in an
// in-process Postgres (PGlite) with Supabase's auth/roles stubbed. The app
// itself is native Swift and has its own XCTest suite.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
