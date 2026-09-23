import { cn, matchTier } from "@/lib/utils";

const tierStyles = {
  high: "bg-acid text-acid-ink",
  mid: "bg-paper text-ink",
  low: "bg-transparent text-paper-dim border border-ink-border",
};

export default function MatchBadge({
  percent,
  size = "md",
  className,
}: {
  percent: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const tier = matchTier(percent);
  const sizes = {
    sm: "text-[10px] px-2 py-1",
    md: "text-xs px-2.5 py-1.5",
    lg: "text-sm px-3.5 py-2",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono font-medium uppercase tracking-wider",
        tierStyles[tier],
        sizes[size],
        className
      )}
    >
      {percent}% match
    </span>
  );
}
