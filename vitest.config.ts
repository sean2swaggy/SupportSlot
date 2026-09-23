import { defineConfig } from "vitest/config";
import path from "path";

// Unit tests only — pure logic in src/lib, no React rendering, no DB. See
// supabase/tests/ for the RLS/privacy checks this can't cover (needs a
// live Postgres instance, run manually in the Supabase SQL editor).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
