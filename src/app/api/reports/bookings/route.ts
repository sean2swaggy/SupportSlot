import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function csvField(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Booking & payment report export — Support+ only, enforced here against a
// fresh DB read of the caller's own profile (never a client-supplied flag),
// same principle as every other server-side subscription check in this app.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_support_plus")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "promoter") {
    return NextResponse.json({ error: "Reports are only available for promoter accounts." }, { status: 403 });
  }
  if (!profile.is_support_plus) {
    return NextResponse.json({ error: "Report exports need an active Support+ subscription." }, { status: 402 });
  }

  const { data: slotRows } = await supabase.from("slots").select("id").eq("promoter_id", user.id);
  const slotIds = (slotRows ?? []).map((s: { id: string }) => s.id);

  const rows: string[] = [
    "booking_id,status,artist_name,show,venue_city,date,support_fee,booking_fee,submitted_at",
  ];

  if (slotIds.length > 0) {
    const { data } = await supabase
      .from("applications")
      .select(
        "id, status, submitted_at, artists(name), slots(headliner, city, date, support_fee, booking_fee)"
      )
      .in("slot_id", slotIds)
      .order("submitted_at", { ascending: false });

    for (const row of data ?? []) {
      const artist = row.artists as unknown as { name: string } | null;
      const slot = row.slots as unknown as {
        headliner: string;
        city: string;
        date: string;
        support_fee: number;
        booking_fee: number;
      } | null;
      if (!slot) continue;
      rows.push(
        [
          row.id,
          row.status,
          artist?.name ?? "",
          slot.headliner,
          slot.city,
          slot.date,
          slot.support_fee,
          slot.booking_fee,
          row.submitted_at,
        ]
          .map(csvField)
          .join(",")
      );
    }
  }

  return new NextResponse(rows.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="support-slot-bookings-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
