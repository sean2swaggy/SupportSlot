import Link from "next/link";

// Previously an interactive "Report a listing" / "Block a user" modal that
// showed a fake "Report submitted — reviewed within 24 hours" / "User
// blocked" confirmation on click, with no backend call behind it at all —
// found during a pre-launch security/trust audit. That's a false safety
// claim on the one page whose whole purpose is describing how users are
// protected: someone who "reported" a scammer or "blocked" a harasser here
// had done neither, while believing they had.
//
// The real reporting/blocking backend does exist (reports and
// promoter_blocks tables, RLS-scoped to the reporting artist — see
// blockPromoter/reportUser in src/lib/queries.ts) but only in the
// signed-in app, attached to a specific promoter/message/request — this
// page is public and has no specific listing in view, so there's nothing
// concrete for a contextless demo here to actually submit. Pointing to the
// real, working entry points instead of faking one.
export default function ReportBlockDemo() {
  return (
    <div className="text-sm text-paper-dim space-y-2">
      <p>
        Report or block someone directly from wherever you see them — a promoter&rsquo;s
        availability request, a message thread, or your{" "}
        <Link href="/requests" className="underline hover:text-paper">
          Requests
        </Link>{" "}
        page. Every report goes to our trust &amp; safety team; a block is silent and immediate.
      </p>
      <p>
        <Link href="/login" className="underline hover:text-paper">
          Sign in
        </Link>{" "}
        to use either from an account.
      </p>
    </div>
  );
}
