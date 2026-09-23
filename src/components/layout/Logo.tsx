import Link from "next/link";
import { cn } from "@/lib/utils";

export default function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "font-display text-lg sm:text-xl font-medium uppercase tracking-tight leading-none select-none",
        className
      )}
    >
      Support<span className="text-acid">/</span>Slot
    </Link>
  );
}
