"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

const TARGET_DIMENSION = 480;
const JPEG_QUALITY = 0.88;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024; // 15MB sanity cap

// Neutral placeholder shown before any photo is uploaded and no fallbackSrc
// is supplied — a plain silhouette, not tied to any mock account. Exported
// so other avatar displays (Navbar, PayoutPanel, etc.) can share it.
export const DEFAULT_FALLBACK =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' fill='%23222220'/%3E%3Ccircle cx='48' cy='38' r='18' fill='%233a3a37'/%3E%3Cellipse cx='48' cy='88' rx='32' ry='24' fill='%233a3a37'/%3E%3C/svg%3E";

/**
 * Reads an image file, center-crops it to a square and resizes it, returning
 * a compressed data URL — same client-side-only approach as
 * ImageUploadField, sized and cropped for a profile picture instead of a
 * 16:9 listing image.
 */
function cropToSquareDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That doesn't look like a valid image."));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const dim = Math.min(TARGET_DIMENSION, side);
        const canvas = document.createElement("canvas");
        canvas.width = dim;
        canvas.height = dim;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Image processing isn't supported in this browser."));
          return;
        }
        ctx.drawImage(img, sx, sy, side, side, 0, 0, dim, dim);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function AvatarUploadField({
  value,
  fallbackSrc,
  onChange,
  alt = "",
  size = 96,
  className,
}: {
  value: string | null;
  fallbackSrc?: string;
  onChange: (dataUrl: string | null) => void;
  alt?: string;
  size?: number;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setError("That image is too large — try one under 15MB.");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await cropToSquareDataUrl(file);
      onChange(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't process that image.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("inline-flex flex-col items-start gap-2", className)}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      <div className="relative shrink-0" style={{ width: size, height: size }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={value || fallbackSrc || DEFAULT_FALLBACK}
          alt={alt}
          className="h-full w-full rounded-full object-cover border border-ink-border"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label={value ? "Replace profile picture" : "Upload profile picture"}
          className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-acid text-acid-ink border-2 border-ink hover:bg-paper transition-colors disabled:opacity-60"
        >
          {busy ? (
            <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="13" r="3.2" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          )}
        </button>
      </div>

      {value && (
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setError(null);
            if (inputRef.current) inputRef.current.value = "";
          }}
          className="font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-signal transition-colors"
        >
          Remove photo
        </button>
      )}

      {error && <p className="text-[11px] text-signal max-w-[24ch]">{error}</p>}
    </div>
  );
}
