import { cn } from "@/lib/utils";

export default function VerifiedBadge({
  size = "sm",
  className,
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  const dim = size === "sm" ? 14 : 18;
  return (
    <span
      title="Verified"
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
    >
      <svg
        width={dim}
        height={dim}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M12 2 14.5 4.2 17.7 3.6 18.7 6.7 21.5 8.3 20.4 11.5 21.5 14.7 18.7 16.3 17.7 19.4 14.5 18.8 12 21 9.5 18.8 6.3 19.4 5.3 16.3 2.5 14.7 3.6 11.5 2.5 8.3 5.3 6.7 6.3 3.6 9.5 4.2Z"
          fill="var(--color-acid)"
        />
        <path
          d="M8.5 12.2 10.8 14.5 15.5 9.5"
          stroke="var(--color-acid-ink)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
