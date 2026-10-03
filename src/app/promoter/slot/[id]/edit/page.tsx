import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBookingsForSlot, getSlot } from "@/lib/queries";
import ListingForm from "@/components/listings/ListingForm";

export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [slot, userResult] = await Promise.all([getSlot(supabase, id), supabase.auth.getUser()]);
  const user = userResult.data.user;
  // Owner-only; anyone else sees the same "not found" as a missing listing.
  if (!slot || !user || slot.promoterId !== user.id) notFound();
  if (slot.status === "cancelled" || slot.status === "filled") notFound();

  const bookings = await getBookingsForSlot(supabase, slot.id);
  const materialLocked = bookings.some((b) => b.status === "offered" || b.status === "confirmed");
  return <ListingForm mode="edit" existing={slot} materialLocked={materialLocked} />;
}
