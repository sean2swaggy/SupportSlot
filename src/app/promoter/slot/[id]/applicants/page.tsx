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

  if (!slot || !venue) {
    notFound();
  }

  return <ApplicantManagementClient slot={slot} venue={venue} />;
}
