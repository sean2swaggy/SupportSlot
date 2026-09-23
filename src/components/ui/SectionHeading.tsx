import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export default function SectionHeading({
  eyebrow,
  title,
  action,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-end justify-between gap-4 border-b border-ink-border pb-4",
        className
      )}
    >
      <div>
        {eyebrow && (
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-acid mb-2">
            {eyebrow}
          </p>
        )}
        <h2 className="font-display text-2xl sm:text-3xl uppercase tracking-tight leading-none">
          {title}
        </h2>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
