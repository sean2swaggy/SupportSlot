import { cn } from "@/lib/utils";

export function Tag({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono text-[10px] uppercase tracking-widest text-paper-dim border border-ink-border px-2 py-1",
        className
      )}
    >
      {children}
    </span>
  );
}

export function GenreTag({ genre }: { genre: string }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
      {genre}
    </span>
  );
}
