import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSlot, getVenue, getPromoter } from "@/lib/queries";
import SlotDetailClient from "@/components/slots/SlotDetailClient";

export default async function SlotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const slot = await getSlot(supabase, id);
  const [venue, promoter] = slot
    ? await Promise.all([getVenue(supabase, slot.venueId), getPromoter(supabase, slot.promoterId)])
    : [undefined, undefined];

  if (!slot || !venue || !promoter) {
    notFound();
  }

  return <SlotDetailClient slot={slot} venue={venue} promoter={promoter} />;
}
