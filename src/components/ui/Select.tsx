"use client";

import { cn } from "@/lib/utils";

export default function Select({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const active = options.find((o) => o.value === value)?.label !== options[0]?.label;
  return (
    <label
      className={cn(
        "relative flex items-center gap-2 border px-3 py-2.5 cursor-pointer transition-colors",
        active ? "border-acid text-acid" : "border-ink-border text-paper hover:border-paper",
        className
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent pr-4 font-mono text-[11px] uppercase tracking-widest outline-none cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-ink-card text-paper">
            {o.label}
          </option>
        ))}
      </select>
      <svg
        width="9"
        height="6"
        viewBox="0 0 9 6"
        fill="none"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
      >
        <path d="M1 1l3.5 3.5L8 1" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    </label>
  );
}
