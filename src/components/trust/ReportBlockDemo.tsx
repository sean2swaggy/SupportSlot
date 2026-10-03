import Link from "next/link";

// Previously an interactive "Report a listing" / "Block a user" modal that
// showed a fake "Report submitted — reviewed within 24 hours" / "User
// blocked" confirmation on click, with no backend call behind it at all —
// found during a pre-launch security/trust audit. That's a false safety
// claim on the one page whose whole purpose is describing how users are
// protected: someone who "reported" a scammer or "blocked" a harasser here
// had done neither, while believing they had.
//
// Reporting and blocking now exist for real (ReportModal → submit_report,
// reviewed at /admin). This page is public and has no specific listing in
// view, so it points to the working entry points instead of faking one.
export default function ReportBlockDemo() {
  return (
    <div className="text-sm text-paper-dim space-y-2">
      <p>
        Use <span className="text-paper">Report</span> on a listing page, in a conversation, or on an availability request. Reports
        go to our team and you get a reference when it&rsquo;s received. Artists can also{" "}
        <span className="text-paper">block</span> a promoter from a conversation, which stops them messaging or inviting you.
      </p>
      <p>
        Locked out, or something to raise that isn&rsquo;t about one listing or person? Use our{" "}
        <Link href="/support" className="underline hover:text-paper">
          support form
        </Link>
        .
      </p>
    </div>
  );
}
