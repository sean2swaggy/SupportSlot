"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

export default function Modal({
  open,
  onClose,
  children,
  className,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/85 backdrop-blur-sm"
      />
      <div
        className={cn(
          "relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-ink-card border border-ink-border sm:mx-4 animate-in",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
