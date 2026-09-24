"use client";

import { evaluatePassword } from "@/lib/password";
import { cn } from "@/lib/utils";

const SCORE_COLOR = ["bg-signal", "bg-signal", "bg-yellow-500", "bg-acid", "bg-acid"];

export default function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const { score, label, blockingIssues } = evaluatePassword(password);

  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn("h-1 flex-1 rounded-full", i < score ? SCORE_COLOR[score] : "bg-ink-border")}
          />
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-paper-dim">
        {blockingIssues.length > 0 ? blockingIssues[0] : `${label} password`}
      </p>
    </div>
  );
}
