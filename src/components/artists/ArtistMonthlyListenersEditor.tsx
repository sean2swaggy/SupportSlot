"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import type { Artist } from "@/lib/types";
import Button from "@/components/ui/Button";

export default function ArtistMonthlyListenersEditor({ artist }: { artist: Artist }) {
  const { setArtistMonthlyListeners } = useStore();
  const [draft, setDraft] = useState<string>(() => String(artist.monthlyListeners));
  const [savedPulse, setSavedPulse] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChange = (value: string) => {
    setDraft(value.replace(/[^0-9]/g, ""));
    setSavedPulse(false);
  };

  const handleSave = async () => {
    const n = Math.max(0, Math.round(Number(draft) || 0));
    setSaving(true);
    await setArtistMonthlyListeners(n);
    setSaving(false);
    setDraft(String(n));
    setSavedPulse(true);
    setTimeout(() => setSavedPulse(false), 2000);
  };

  return (
    <div className="border border-ink-border p-5 sm:p-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-1">
        Monthly listeners
      </p>
      <p className="text-xs text-paper-dim mb-4 max-w-[56ch]">
        We&rsquo;re unable to link your live monthly listeners — please add your current count and
        we&rsquo;ll show it on your profile.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          inputMode="numeric"
          placeholder="e.g. 1800"
          className="w-40 border border-ink-border bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60"
        />
        <Button onClick={handleSave} size="md" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {savedPulse && (
          <span className="font-mono text-[10px] uppercase tracking-widest text-ok">Saved ✓</span>
        )}
      </div>
    </div>
  );
}
