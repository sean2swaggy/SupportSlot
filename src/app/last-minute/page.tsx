"use client";

import { Suspense, useState } from "react";
import { useStore } from "@/lib/store";
import SlotBrowser from "@/components/discovery/SlotBrowser";
import UrgentPulse from "@/components/ui/UrgentPulse";

function AlertToggle() {
  const { role, signedIn, currentArtist, lastMinuteAlertsEnabled, setLastMinuteAlertsEnabled } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!signedIn || role !== "artist" || !currentArtist) return null;
  return (
    <div className="mt-8 border border-ink-border p-4 max-w-2xl">
      <label className="flex items-center justify-between gap-4 cursor-pointer">
        <span>
          <span className="block text-sm">Alert me about last-minute slots</span>
          <span className="block text-xs text-paper-dim mt-0.5">
            When a promoter posts an urgent listing in a city within your {currentArtist.travelRadiusMiles}-mile travel radius, you get
            an in-app notification. (Change the radius on your profile.) Turning this on never means a promoter can book you — you
            still apply.
          </span>
        </span>
        <input
          type="checkbox"
          checked={lastMinuteAlertsEnabled}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            setError(null);
            const result = await setLastMinuteAlertsEnabled(e.target.checked);
            if (!result.ok) setError(result.error);
            setBusy(false);
          }}
          className="h-5 w-5 accent-[var(--color-acid)] shrink-0"
        />
      </label>
      {error && <p className="mt-2 text-sm text-signal" role="alert">{error}</p>}
    </div>
  );
}

export default function LastMinutePage() {
  return (
    <Suspense fallback={null}>
      <SlotBrowser
        urgentOnly
        heading={
          <>
            <UrgentPulse label="Live now" />
            <h1 className="font-display uppercase text-4xl sm:text-6xl leading-[0.95] tracking-tight mt-4">Needed tonight</h1>
            <p className="mt-4 max-w-[54ch] text-paper-dim">
              Support acts drop out. When they do, promoters post here — urgent listings that are still open for applications.
            </p>
            <AlertToggle />
          </>
        }
      />
    </Suspense>
  );
}
