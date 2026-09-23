"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "./Logo";
import NotificationsPanel from "./NotificationsPanel";
import Button from "@/components/ui/Button";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_FALLBACK } from "@/components/ui/AvatarUploadField";

const artistLinks = [
  { href: "/discover", label: "Find a Slot" },
  { href: "/last-minute", label: "Last-Minute" },
  { href: "/applications", label: "Applications" },
  { href: "/requests", label: "Requests" },
];

// Focused per the artist-discovery redesign: browsing artists is now the
// promoter's primary destination, not a secondary tab. Availability
// requests (Support+) stays reachable from the dashboard and roster pages
// rather than living in top-level nav alongside these five.
const promoterLinks = [
  { href: "/discover", label: "Discover Artists" },
  { href: "/dashboard/promoter", label: "My Gigs" },
  { href: "/dashboard/promoter#applicants", label: "Applications" },
  { href: "/dashboard/promoter/roster", label: "Artist Roster" },
  { href: "/messages", label: "Messages" },
  { href: "/support-plus", label: "Support+" },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { role, artistAvatar, promoterAvatar } = useStore();
  const links = role === "artist" ? artistLinks : promoterLinks;
  const avatarSrc = (role === "artist" ? artistAvatar : promoterAvatar) || DEFAULT_FALLBACK;

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-30 border-b border-ink-border bg-ink/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-4 sm:px-6 lg:px-10">
        <div className="flex items-center gap-10">
          <Logo />
          <nav className="hidden lg:flex items-center gap-7">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "font-mono text-xs uppercase tracking-widest transition-colors",
                  pathname === l.href
                    ? "text-acid"
                    : "text-paper-dim hover:text-paper"
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:block">
            {role === "artist" ? (
              <Button href="/discover" variant="outline" size="sm">
                Find Support Slots
              </Button>
            ) : (
              <Button href="/create-slot" variant="primary" size="sm">
                Post a Slot
              </Button>
            )}
          </div>
          <NotificationsPanel />
          <Link
            href={role === "artist" ? "/dashboard/artist" : "/dashboard/promoter"}
            className="hidden sm:flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-ink-border hover:border-paper transition-colors"
            aria-label="Your dashboard"
          >
            <img
              src={avatarSrc}
              alt=""
              className="h-full w-full object-cover"
            />
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="hidden sm:block font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-signal transition-colors"
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
