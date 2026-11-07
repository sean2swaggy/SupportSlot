import type { ReactNode } from "react";
import { dayNum, monthShort, weekday } from "../domain/dates";
import type { BookingStatus, ListingStatus } from "../domain/types";

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite" aria-busy="true">
      <div className="skeleton-list" aria-hidden="true">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton-row" />)}
      </div>
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state state-empty">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <h2>That didn't work</h2>
      <p>{error.message}</p>
      {onRetry && <button className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function DateBlock({ date, muted }: { date: string; muted?: boolean }) {
  return (
    <div className={`dateblock${muted ? " muted" : ""}`} aria-hidden="true">
      <span className="dow">{weekday(date)}</span>
      <span className="day">{dayNum(date)}</span>
      <span className="mon">{monthShort(date)}</span>
    </div>
  );
}

type Tone = "open" | "pending" | "confirmed" | "cancelled" | "past" | "neutral";
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function listingBadge(s: ListingStatus) {
  return s === "open" ? <Badge tone="open">Open</Badge> : s === "booked" ? <Badge tone="confirmed">Booked</Badge> : <Badge tone="cancelled">Cancelled</Badge>;
}
export function bookingBadge(s: BookingStatus, past: boolean) {
  return s === "cancelled" ? <Badge tone="cancelled">Cancelled</Badge> : past ? <Badge tone="past">Played</Badge> : <Badge tone="confirmed">Confirmed</Badge>;
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <p className="hint" id={`${htmlFor}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${htmlFor}-err`} role="alert">{error}</p>}
    </div>
  );
}
