"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import type { Artist } from "@/lib/types";
import { PLATFORM_LABELS, type ArtistLinksOverride, type LinkPlatform } from "@/lib/artist-links";
import Button from "@/components/ui/Button";

const FIELDS: { key: LinkPlatform; placeholder: string }[] = [
  { key: "spotifyUrl", placeholder: "https://open.spotify.com/artist/…" },
  { key: "soundcloudUrl", placeholder: "https://soundcloud.com/…" },
  { key: "bandcampUrl", placeholder: "https://yourname.bandcamp.com" },
  { key: "youtubeUrl", placeholder: "https://youtube.com/@…" },
  { key: "instagramUrl", placeholder: "https://instagram.com/…" },
  { key: "tiktokUrl", placeholder: "https://tiktok.com/@…" },
  { key: "websiteUrl", placeholder: "https://yoursite.com" },
];

function linksOf(artist: Artist): ArtistLinksOverride {
  return {
    spotifyUrl: artist.spotifyUrl,
    instagramUrl: artist.instagramUrl,
    tiktokUrl: artist.tiktokUrl,
    soundcloudUrl: artist.soundcloudUrl,
    bandcampUrl: artist.bandcampUrl,
    youtubeUrl: artist.youtubeUrl,
    websiteUrl: artist.websiteUrl,
  };
}

export default function ArtistLinksEditor({ artist }: { artist: Artist }) {
  const { setArtistLinks } = useStore();
  const [draft, setDraft] = useState<ArtistLinksOverride>(() => linksOf(artist));
  const [savedPulse, setSavedPulse] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChange = (key: LinkPlatform, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSavedPulse(false);
  };

  const handleSave = async () => {
    setSaving(true);
    await setArtistLinks(draft);
    setSaving(false);
    setSavedPulse(true);
    setTimeout(() => setSavedPulse(false), 2000);
  };

  return (
    <div className="border border-ink-border p-5 sm:p-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-1">Your links</p>
      <p className="text-xs text-paper-dim mb-5 max-w-[56ch]">
        Shown on your public profile so promoters can listen and check out your socials. Leave any
        field blank to hide it.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
              {PLATFORM_LABELS[f.key]}
            </label>
            <input
              value={draft[f.key] || ""}
              onChange={(e) => handleChange(f.key, e.target.value)}
              placeholder={f.placeholder}
              className="w-full border border-ink-border bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60"
            />
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center gap-3">
        <Button onClick={handleSave} size="md" disabled={saving}>
          {saving ? "Saving…" : "Save links"}
        </Button>
        {savedPulse && (
          <span className="font-mono text-[10px] uppercase tracking-widest text-ok">Saved ✓</span>
        )}
      </div>
    </div>
  );
}
