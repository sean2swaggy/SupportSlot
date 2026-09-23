"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { addToRoster, removeFromRoster } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * "Save artists from profiles or applications" — the one entry point used
 * from both the public artist profile and applicant-management cards (see
 * ArtistCard's `children` slot). Renders nothing for artists or for
 * signed-out visitors; only ever visible to a promoter viewing an artist.
 */
export default function SaveToRosterButton({
  artistId,
  size = "md",
}: {
  artistId: string;
  size?: "sm" | "md";
}) {
  const { role, currentPromoterId, isSupportPlus } = useStore();
  const [rosterEntryId, setRosterEntryId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (role !== "promoter" || !currentPromoterId) return;
    const supabase = createClient();
    supabase
      .from("artist_roster")
      .select("id")
      .eq("promoter_id", currentPromoterId)
      .eq("artist_id", artistId)
      .maybeSingle()
      .then(({ data }) => setRosterEntryId(data?.id ?? null));
  }, [role, currentPromoterId, artistId]);

  if (role !== "promoter" || !currentPromoterId || rosterEntryId === undefined) return null;

  const saved = !!rosterEntryId;

  const toggle = async () => {
    if (!isSupportPlus) return;
    setBusy(true);
    const supabase = createClient();
    if (saved && rosterEntryId) {
      const ok = await removeFromRoster(supabase, rosterEntryId);
      if (ok) setRosterEntryId(null);
    } else {
      const result = await addToRoster(supabase, currentPromoterId, artistId);
      if (result.ok) {
        const { data } = await supabase
          .from("artist_roster")
          .select("id")
          .eq("promoter_id", currentPromoterId)
          .eq("artist_id", artistId)
          .maybeSingle();
        setRosterEntryId(data?.id ?? null);
      }
    }
    setBusy(false);
  };

  if (!isSupportPlus) {
    return (
      <a
        href="/support-plus"
        title="Save artists to your roster with Support+"
        className={cn(
          "inline-flex items-center gap-1.5 border border-ink-border px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:border-paper transition-colors",
          size === "sm" && "px-2.5 py-1.5"
        )}
      >
        ☆ Save (Support+)
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-1.5 border px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors disabled:opacity-50",
        saved ? "border-acid text-acid" : "border-ink-border text-paper-dim hover:border-paper",
        size === "sm" && "px-2.5 py-1.5"
      )}
    >
      {saved ? "★ On roster" : "☆ Save to roster"}
    </button>
  );
}
