import type { CapacitorConfig } from "@capacitor/cli";

// The app is a native shell around the deployed Next.js site — Support Slot
// relies on middleware, API routes and server components, so it can't be
// exported as static files. Point CAP_SERVER_URL at the production URL for
// real builds; it defaults to the local dev server for the simulator.
const config: CapacitorConfig = {
  appId: "com.supportslot.app",
  appName: "Support Slot",
  webDir: "cap-www",
  server: {
    url: process.env.CAP_SERVER_URL ?? "http://localhost:3000",
    cleartext: true,
  },
  ios: {
    contentInset: "always",
    backgroundColor: "#0a0a0b",
  },
};

export default config;
