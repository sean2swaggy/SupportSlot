import ReportBlockDemo from "@/components/trust/ReportBlockDemo";

const POLICIES = [
  {
    t: "No pay-to-play",
    d: "Artists never pay a promoter, venue or Support Slot for the privilege of performing. Anyone requesting payment to perform is breaking our terms — report them immediately.",
  },
  {
    t: "No application fees",
    d: "Applying to a support slot is always free, no matter how many shows you apply to.",
  },
  {
    t: "Transparent compensation",
    d: "Every listing shows the support fee and travel contribution up front, before you apply. What you see is what you're offered.",
  },
  {
    t: "Verified promoters & venues",
    d: "Promoters and venues can apply for a verification badge once we've confirmed their identity and booking history.",
  },
  {
    t: "Clear payment information",
    d: "When a promoter books an artist, the fee split is shown before confirming: the artist's full fee, and Support Slot's separate booking fee, paid by the promoter.",
  },
  {
    t: "Cancellation policy",
    d: "Either side can cancel a confirmed booking, but repeated late cancellations affect your account standing and visibility in search.",
  },
];

export default function TrustPage() {
  return (
    <div className="mx-auto max-w-[900px] px-4 sm:px-6 lg:px-10 py-10 sm:py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">
        Trust &amp; safety
      </p>
      <h1 className="font-display uppercase text-4xl sm:text-6xl leading-[0.95] tracking-tight">
        No pay-to-play. Ever.
      </h1>
      <p className="mt-5 max-w-[58ch] text-lg text-paper-dim">
        Support Slot exists to get artists in front of the right audiences — never to charge them
        for the opportunity. Here&rsquo;s exactly how we protect that.
      </p>

      <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-9">
        {POLICIES.map((p, i) => (
          <div key={p.t} className="border-t border-ink-border pt-4">
            <p className="font-mono text-xs text-acid">{String(i + 1).padStart(2, "0")}</p>
            <p className="font-display text-xl mt-2">{p.t}</p>
            <p className="text-sm text-paper-dim mt-1.5">{p.d}</p>
          </div>
        ))}
      </div>

      <div className="mt-16 border border-ink-border bg-ink-raised p-6 sm:p-8">
        <p className="font-display text-2xl">See something wrong?</p>
        <p className="mt-2 text-sm text-paper-dim max-w-[54ch]">
          Report a listing that requests payment, misrepresents a show, or breaks any of the
          policies above. You can also block a user at any time — they won&rsquo;t be notified.
        </p>
        <div className="mt-5">
          <ReportBlockDemo />
        </div>
      </div>
    </div>
  );
}
