"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

export default function ReportBlockDemo() {
  const [modal, setModal] = useState<"report" | "block" | null>(null);
  const [done, setDone] = useState(false);

  const close = () => {
    setModal(null);
    setTimeout(() => setDone(false), 300);
  };

  return (
    <div className="flex flex-wrap gap-3">
      <Button variant="outline" size="md" onClick={() => setModal("report")}>
        Report a listing
      </Button>
      <Button variant="outline" size="md" onClick={() => setModal("block")}>
        Block a user
      </Button>

      <Modal open={!!modal} onClose={close}>
        <div className="p-6 sm:p-7">
          {done ? (
            <div className="text-center py-4">
              <p className="font-display text-2xl">
                {modal === "report" ? "Report submitted" : "User blocked"}
              </p>
              <p className="mt-2 text-sm text-paper-dim">
                {modal === "report"
                  ? "Our trust & safety team reviews every report within 24 hours."
                  : "They can no longer message you or view your profile."}
              </p>
              <Button size="md" className="mt-6" onClick={close}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <p className="font-display text-2xl">
                {modal === "report" ? "Report this listing" : "Block this user"}
              </p>
              <p className="mt-2 text-sm text-paper-dim">
                {modal === "report"
                  ? "Tell us what's wrong — pay-to-play requests, misleading information, or anything that breaks our policies."
                  : "They won't be notified. You can unblock them at any time from your settings."}
              </p>
              {modal === "report" && (
                <textarea
                  rows={3}
                  placeholder="What happened?"
                  className="mt-4 w-full resize-none border border-ink-border bg-transparent p-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60"
                />
              )}
              <Button size="md" className="w-full mt-5" onClick={() => setDone(true)}>
                {modal === "report" ? "Submit report" : "Confirm block"}
              </Button>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
