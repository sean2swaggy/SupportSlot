"use client";

import { Suspense } from "react";
import { useStore } from "@/lib/store";
import PromoterDiscoverArtists from "@/components/discovery/PromoterDiscoverArtists";
import SlotBrowser from "@/components/discovery/SlotBrowser";

// Role-aware on purpose, same URL either way: signed-out visitors and
// artists browse listings; a promoter's /discover is artist discovery.
export default function DiscoverPage() {
  const { role, signedIn } = useStore();
  if (signedIn && role === "promoter") return <PromoterDiscoverArtists />;
  return (
    <Suspense fallback={null}>
      <SlotBrowser
        heading={
          <>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">Find a slot</p>
            <h1 className="font-display uppercase text-4xl sm:text-6xl leading-[0.95] tracking-tight">Support opportunities</h1>
            <p className="mt-4 max-w-[54ch] text-paper-dim">
              Every open support slot, searchable and filterable. Only listings that are still open for applications are shown.
            </p>
          </>
        }
      />
    </Suspense>
  );
}
