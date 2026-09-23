"use client";

import { useState } from "react";
import Link from "next/link";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { useStore } from "@/lib/store";
import { computeMatch } from "@/lib/match";
import type { Artist, SupportSlot } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function ApplyModal({
  open,
  onClose,
  slot,
  artist,
}: {
  open: boolean;
  onClose: () => void;
  slot: SupportSlot;
  artist: Artist;
}) {
  const { addApplication } = useStore();
  const [trackId, setTrackId] = useState(artist.tracks[0]?.id ?? "");
  const [videoSelected, setVideoSelected] = useState(true);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const close = () => {
    onClose();
    setTimeout(() => setSubmitted(false), 300);
  };

  const handleSubmit = () => {
    addApplication({
      slotId: slot.id,
      featuredTrackId: trackId,
      message: message.trim() || undefined,
      matchPercent: computeMatch(artist, slot),
    });
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <Modal open={open} onClose={close}>
        <div className="p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center border border-acid text-acid">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M4 12.5 9.5 18 20 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="font-display text-2xl mt-5">Application submitted</p>
          <p className="mt-2 text-sm text-paper-dim max-w-[38ch] mx-auto">
            {slot.headliner} will review your application. We&rsquo;ll let you know the moment
            your status changes — no need to follow up.
          </p>
          <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
            <Button href="/applications" size="md">
              View your applications
            </Button>
            <Button variant="outline" size="md" onClick={close}>
              Keep browsing
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={close} labelledBy="apply-modal-title">
      <div className="p-6 sm:p-7">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
              Applying to support
            </p>
            <h2 id="apply-modal-title" className="font-display text-2xl mt-1">
              {slot.headliner}
            </h2>
          </div>
          <button
            onClick={close}
            aria-label="Close"
            className="text-paper-dim hover:text-paper text-xl leading-none"
          >
            ×
          </button>
        </div>

        <p className="mt-4 text-xs text-paper-dim">
          Pulled straight from your profile — nothing to re-type.
        </p>

        {artist.tracks.length > 0 && (
        <div className="mt-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-3">
            Choose one featured song
          </p>
          <div className="space-y-2">
            {artist.tracks.map((t) => (
              <label
                key={t.id}
                className={cn(
                  "flex items-center gap-3 border p-3 cursor-pointer transition-colors",
                  trackId === t.id ? "border-acid bg-acid/5" : "border-ink-border hover:border-paper-dim"
                )}
              >
                <input
                  type="radio"
                  name="track"
                  className="accent-[var(--color-acid)]"
                  checked={trackId === t.id}
                  onChange={() => setTrackId(t.id)}
                />
                <img src={t.coverImage} alt="" className="h-10 w-10 object-cover shrink-0" />
                <span className="flex-1 text-sm">{t.title}</span>
                <span className="font-mono text-xs text-paper-dim">{t.duration}</span>
              </label>
            ))}
          </div>
        </div>
        )}

        {artist.liveVideoThumbnail && (
          <div className="mt-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-3">
              Choose live performance video
            </p>
            <label
              className={cn(
                "flex items-center gap-3 border p-3 cursor-pointer transition-colors",
                videoSelected ? "border-acid bg-acid/5" : "border-ink-border hover:border-paper-dim"
              )}
            >
              <input
                type="checkbox"
                className="accent-[var(--color-acid)]"
                checked={videoSelected}
                onChange={(e) => setVideoSelected(e.target.checked)}
              />
              <img
                src={artist.liveVideoThumbnail}
                alt=""
                className="h-10 w-16 object-cover shrink-0"
              />
              <span className="flex-1 text-sm">Live performance clip</span>
            </label>
            {!videoSelected && (
              <p className="mt-2 text-[11px] text-paper-dim">
                We recommend including a live clip — applications with video get shortlisted more often.
              </p>
            )}
          </div>
        )}

        <div className="mt-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-3">
            Optional short message
          </p>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={280}
            rows={3}
            placeholder="Tell them why you're a good fit for this show..."
            className="w-full resize-none border border-ink-border bg-transparent p-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60"
          />
          <p className="mt-1 text-right font-mono text-[10px] text-paper-dim">
            {message.length}/280
          </p>
        </div>

        <Button onClick={handleSubmit} size="lg" className="w-full mt-2">
          Submit application
        </Button>
        <p className="mt-3 text-center text-[11px] text-paper-dim">
          No application fees. Ever. <Link href="/trust" className="underline">Learn more</Link>
        </p>
      </div>
    </Modal>
  );
}
