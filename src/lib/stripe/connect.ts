import { stripe } from "@/lib/stripe/server";

// Asks STRIPE (not our database) whether a connected account can currently
// receive transfers. The stored flag is only a cache for the UI; every
// payment re-checks here, so a restricted or deactivated account can't be
// sent money.
export async function fetchTransfersActive(accountId: string): Promise<boolean> {
  const account = await stripe.v2.core.accounts.retrieve(accountId, { include: ["configuration.recipient"] });
  return account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active";
}
