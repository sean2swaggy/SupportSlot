import { cn } from "@/lib/utils";

/**
 * Marks an artist as a paying Support+ member. Deliberately distinct from
 * VerifiedBadge (identity verification) — this is a membership indicator
 * only. Support+ never affects match scoring or ranking (see /support-plus),
 * so this badge is purely informational, not a trust or quality signal.
 */
export default function SupportPlusBadge({
  size = "sm",
  className,
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  const sizes = {
    sm: "text-[9px] px-1.5 py-[3px] gap-1",
    md: "text-[10px] px-2 py-1 gap-1",
  };
  const iconDim = size === "sm" ? 9 : 10;

  return (
    <span
      title="Support+ member"
      className={cn(
        "inline-flex shrink-0 items-center font-mono uppercase tracking-widest border border-acid text-acid whitespace-nowrap",
        sizes[size],
        className
      )}
    >
      <svg width={iconDim} height={iconDim} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor" />
      </svg>
      Support+
    </span>
  );
}
