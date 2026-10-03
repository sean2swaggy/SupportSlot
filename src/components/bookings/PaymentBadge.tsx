import { cn } from "@/lib/utils";
import type { Booking, PaymentStatus } from "@/lib/types";

const LABEL: Record<PaymentStatus, string> = {
  unpaid: "Awaiting payment",
  processing: "Payment processing",
  paid: "Paid",
  failed: "Payment failed",
  partially_refunded: "Partly refunded",
  refunded: "Refunded",
  disputed: "Payment disputed",
};
const TONE: Record<PaymentStatus, string> = {
  unpaid: "text-paper-dim border-ink-border",
  processing: "text-acid border-acid/60",
  paid: "text-ok border-ok/60",
  failed: "text-signal border-signal/60",
  partially_refunded: "text-acid border-acid/60",
  refunded: "text-paper-dim border-ink-border",
  disputed: "text-signal border-signal/60",
};

export default function PaymentBadge({ booking }: { booking: Pick<Booking, "paymentStatus" | "disputeStatus"> }) {
  const label =
    booking.paymentStatus === "disputed" && booking.disputeStatus === "lost" ? "Dispute lost" : LABEL[booking.paymentStatus];
  return (
    <span className={cn("inline-flex items-center border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest", TONE[booking.paymentStatus])}>
      {label}
    </span>
  );
}
