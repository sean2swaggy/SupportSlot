"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import EmailVerifyPanel from "@/components/account/EmailVerifyPanel";

/**
 * Shown on a dashboard when the (single, mock) account hasn't verified an
 * email yet — lets someone who skipped it at signup (or existing demo
 * accounts from before this existed) do it later.
 */
export default function EmailVerifyBanner() {
  const { emailVerified, accountEmail, markEmailVerified } = useStore();
  const [open, setOpen] = useState(false);

  if (emailVerified) return null;

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border border-acid/50 bg-acid/5 px-5 py-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-acid">
            Verify your email
          </p>
          <p className="mt-1 text-sm text-paper-dim">
            Protect your account and make sure you don&rsquo;t miss booking updates.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Verify now
        </Button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} labelledBy="verify-email-title">
        <div className="p-6 sm:p-7">
          <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
            Account
          </p>
          <h2 id="verify-email-title" className="font-display text-2xl mt-1 mb-5">
            Verify your email
          </h2>
          <EmailVerifyPanel
            initialEmail={accountEmail ?? ""}
            onVerified={(email) => {
              markEmailVerified(email);
              setOpen(false);
            }}
          />
        </div>
      </Modal>
    </>
  );
}
