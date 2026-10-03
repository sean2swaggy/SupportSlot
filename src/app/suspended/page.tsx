"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";

export default function SuspendedPage() {
  const router = useRouter();
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-signal mb-3">Account suspended</p>
      <h1 className="font-display uppercase text-4xl leading-none tracking-tight">This account is suspended</h1>
      <p className="mt-4 text-paper-dim">
        You can&rsquo;t apply, post, message or make payments while an account is suspended. Anything you had in progress was left as
        it was. If you think this is a mistake, contact support and tell us what happened.
      </p>
      <div className="mt-8 flex flex-col sm:flex-row gap-3">
        <Button href="/support">Contact support</Button>
        <Button
          variant="outline"
          onClick={async () => {
            await createClient().auth.signOut();
            router.push("/login");
            router.refresh();
          }}
        >
          Log out
        </Button>
      </div>
      <p className="mt-6 text-xs text-paper-dim">
        Read our <Link href="/terms" className="underline">terms</Link> and <Link href="/trust" className="underline">trust &amp; safety</Link> pages.
      </p>
    </div>
  );
}
