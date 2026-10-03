import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BOOKING_COLUMNS, toBooking, type BookingRow } from "@/lib/supabase/mappers";

// A spreadsheet-safe field: quoted if needed, and neutralised if it starts
// with a character a spreadsheet would treat as a formula (=, +, -, @) — an
// artist's name is user-controlled text going into someone's Excel.
function csvField(v: string | number) {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const pounds = (pence: number) => (pence / 100).toFixed(2);

// Booking & payment report export — Support+ only, enforced here against a
// fresh read of the caller's own profile. Built from the agreed booking terms
// and real payment state, not from the live listing.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please log in again." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role, is_support_plus").eq("id", user.id).maybeSingle();
  if (profile?.role !== "promoter") {
    return NextResponse.json({ error: "Reports are only available for promoter accounts." }, { status: 403 });
  }
  if (!profile.is_support_plus) {
    return NextResponse.json({ error: "Report exports need an active Support+ subscription." }, { status: 402 });
  }

  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("promoter_id", user.id)
    .order("event_date", { ascending: false });
  if (error) return NextResponse.json({ error: "We couldn't build that report just now." }, { status: 500 });

  const rows = [
    "booking_id,status,payment_status,artist,show,venue,city,event_date,artist_fee_gbp,travel_gbp,booking_fee_gbp,processing_fee_gbp,total_gbp,refunded_gbp",
    ...(data as unknown as BookingRow[]).map(toBooking).map((b) =>
      [b.id, b.status, b.paymentStatus, b.artistName, b.headliner, b.venueName, b.venueCity, b.eventDate,
       pounds(b.feePence), pounds(b.travelPence), pounds(b.bookingFeePence), pounds(b.processingFeePence), pounds(b.totalPence), pounds(b.refundedPence)]
        .map(csvField).join(",")
    ),
  ];

  return new NextResponse(rows.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="support-slot-bookings-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
