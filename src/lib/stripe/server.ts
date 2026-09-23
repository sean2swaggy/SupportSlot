import Stripe from "stripe";

// Server-only — STRIPE_SECRET_KEY must never reach the client. Test-mode
// key for now (see .env.local); go-live checklist swaps this for a live key
// stored in the hosting platform's secrets vault, not a committed file.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
