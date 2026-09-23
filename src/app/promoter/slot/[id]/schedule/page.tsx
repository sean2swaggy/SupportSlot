import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSlot, getVenue } from "@/lib/queries";
import ShowScheduleClient from "@/components/schedule/ShowScheduleClient";

// Show Schedule is Support+-only and scoped to the owning promoter's own
// slot — enforced here server-side (not just by the client UI or by the
// database RLS this page's data calls also go through), per the "ownership
// checks on the server" requirement. The route itself is already
// promoter-only at the middleware level (see src/lib/supabase/middleware.ts,
// "/promoter" is a promoter-only prefix); this adds the per-slot ownership
// check middleware can't do with a static path prefix.
export default async function ShowSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const slot = await getSlot(supabase, id);
  const venue = slot ? await getVenue(supabase, slot.venueId) : undefined;
  if (!slot || !venue || slot.promoterId !== user.id) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_support_plus")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <ShowScheduleClient
      slot={slot}
      venue={venue}
      promoterId={user.id}
      isSupportPlus={profile?.is_support_plus ?? false}
    />
  );
}
