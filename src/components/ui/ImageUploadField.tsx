"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

const MAX_DIMENSION = 1400;
const JPEG_QUALITY = 0.85;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024; // 15MB — sanity cap before we even try to read the file

/**
 * Reads an image file and returns a resized/compressed data URL, so a
 * promoter can drop in a big phone photo without bloating localStorage
 * (everything in this prototype persists client-side — see lib/store.tsx).
 */
function resizeImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That doesn't look like a valid image."));
      img.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Image processing isn't supported in this browser."));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function ImageUploadField({
  value,
  onChange,
  label = "Slot image",
  hint = "JPG or PNG, landscape works best (16:9). Resized automatically.",
  className,
  placeholderNote = " No image? We'll use a placeholder until you add one.",
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  label?: string;
  hint?: string;
  className?: string;
  /** Trailing note shown when no image is set yet — pass "" to omit it (e.g. for a truly optional field with no fallback placeholder). */
  placeholderNote?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (JPG, PNG, WebP…).");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setError("That image is too large — try one under 15MB.");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await resizeImageFile(file);
      onChange(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't process that image.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
        {label}
      </label>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {value ? (
        <div className="relative border border-ink-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Slot preview" className="aspect-video w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-ink/80 p-3 backdrop-blur-sm">
            <span className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
              {busy ? "Processing…" : "Image added"}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="font-mono text-[10px] uppercase tracking-widest text-paper hover:text-acid transition-colors"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setError(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
                className="font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-signal transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
          disabled={busy}
          className={cn(
            "flex aspect-video w-full flex-col items-center justify-center gap-2 border border-dashed px-4 text-center transition-colors",
            dragActive ? "border-acid text-acid" : "border-ink-border text-paper-dim hover:border-paper"
          )}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 16V4m0 0-4 4m4-4 4 4M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-mono text-[10px] uppercase tracking-widest">
            {busy ? "Processing…" : "Click or drag an image to upload"}
          </span>
        </button>
      )}

      <p className="mt-2 text-[11px] text-paper-dim">
        {error ? <span className="text-signal">{error}</span> : hint}
        {!value && !error && placeholderNote}
      </p>
    </div>
  );
}
