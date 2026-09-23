"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const ICONS: Record<string, string> = {
  viewed: "◎",
  shortlisted: "★",
  match: "◈",
  urgent: "▲",
  booked: "✓",
  message: "✉",
  availability_request: "◐",
  availability_response: "◑",
};

export default function NotificationsPanel() {
  const { notifications, unreadNotificationCount, markNotificationRead, markAllNotificationsRead } =
    useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center border border-ink-border hover:border-paper transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path
            d="M6 8a6 6 0 1 1 12 0c0 4 1.5 6 2 6.5H4C4.5 14 6 12 6 8Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M9.5 18a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        {unreadNotificationCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center bg-acid px-1 font-mono text-[9px] font-bold text-acid-ink">
            {unreadNotificationCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[340px] max-h-[70vh] overflow-y-auto border border-ink-border bg-ink-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-ink-border px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
              Notifications
            </p>
            {unreadNotificationCount > 0 && (
              <button
                onClick={markAllNotificationsRead}
                className="font-mono text-[10px] uppercase tracking-widest text-acid hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div>
            {notifications.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-paper-dim">
                Nothing yet — check back soon.
              </p>
            )}
            {notifications.map((n) => (
              <Link
                key={n.id}
                href={n.href ?? "#"}
                onClick={() => {
                  markNotificationRead(n.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex gap-3 border-b border-ink-border px-4 py-3 last:border-b-0 hover:bg-ink-raised transition-colors",
                  !n.read && "bg-ink-raised/60"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 font-mono text-sm",
                    n.type === "urgent" ? "text-signal" : "text-acid"
                  )}
                >
                  {ICONS[n.type] ?? "•"}
                </span>
                <span className="flex-1">
                  <span className="block text-sm leading-snug text-paper">{n.text}</span>
                  <span className="mt-1 block font-mono text-[10px] uppercase tracking-widest text-paper-dim">
                    {n.timeAgo}
                  </span>
                </span>
                {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-acid" />}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
