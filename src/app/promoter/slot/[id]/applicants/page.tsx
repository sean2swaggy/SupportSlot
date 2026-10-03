import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSlot, getVenue } from "@/lib/queries";
import ApplicantManagementClient from "@/components/applicants/ApplicantManagementClient";

export default async function ApplicantsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const slot = await getSlot(supabase, id);
  const venue = slot ? await getVenue(supabase, slot.venueId) : undefined;

  // Owner-only. A different signed-in user (or anyone else) gets the same
  // "not found" as a listing that doesn't exist — the page doesn't confirm
  // that the listing is there.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!slot || !venue || !user || slot.promoterId !== user.id) {
    notFound();
  }

  return <ApplicantManagementClient slot={slot} venue={venue} />;
}
