import { cn } from "@/lib/utils";

export default function StatCard({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("border border-ink-border p-5 bg-ink-raised", className)}>
      <p className="font-display text-3xl sm:text-4xl leading-none">{value}</p>
      <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mt-3">
        {label}
      </p>
      {hint && <p className="text-xs text-paper-dim mt-1">{hint}</p>}
    </div>
  );
}
