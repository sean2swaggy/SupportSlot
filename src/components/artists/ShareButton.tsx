"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export default function ShareButton({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-2 border border-ink-border px-4 py-2.5 font-mono text-xs uppercase tracking-widest hover:border-paper transition-colors",
        className
      )}
    >
      {copied ? "Link copied" : "Share profile"}
    </button>
  );
}
