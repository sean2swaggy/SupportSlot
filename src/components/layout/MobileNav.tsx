"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

function DiscoverIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path d="M20 20l-4.3-4.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function AppsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="7" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
function MessagesIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 5h16v11H8l-4 4V5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function ProfileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 20c1.2-3.8 4.2-5.5 7-5.5s5.8 1.7 7 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function MobileNav() {
  const pathname = usePathname();
  const { role, unreadMessageCount } = useStore();

  const isActive = (href: string) => pathname === href;

  // A promoter's primary tab is now artist discovery, same as an artist's
  // primary tab is slot discovery — both point at /discover, which
  // branches by role. Gig management moved to the profile slot ("My
  // Gigs") since it's no longer what this first tab is for.
  const left = { href: "/discover", label: "Discover", icon: <DiscoverIcon /> };
  const secondLeft =
    role === "artist"
      ? { href: "/applications", label: "Applications", icon: <AppsIcon /> }
      : { href: "/dashboard/promoter#applicants", label: "Applicants", icon: <AppsIcon /> };
  const profile =
    role === "artist"
      ? { href: "/dashboard/artist", label: "Profile", icon: <ProfileIcon /> }
      : { href: "/dashboard/promoter", label: "My Gigs", icon: <ProfileIcon /> };
  const plusHref = role === "promoter" ? "/create-slot" : "/last-minute";

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 flex lg:hidden items-stretch justify-between border-t border-ink-border bg-ink/95 backdrop-blur px-2 pb-[env(safe-area-inset-bottom)]"
      aria-label="Primary"
    >
      <NavItem href={left.href} label={left.label} icon={left.icon} active={isActive(left.href)} />
      <NavItem
        href={secondLeft.href}
        label={secondLeft.label}
        icon={secondLeft.icon}
        active={isActive(secondLeft.href)}
      />
      <Link
        href={plusHref}
        aria-label={role === "promoter" ? "Post a support slot" : "Last-minute slots"}
        className="flex flex-col items-center justify-center px-3"
      >
        <span className="flex h-11 w-11 -translate-y-3 items-center justify-center rounded-full bg-acid text-acid-ink shadow-lg">
          <PlusIcon />
        </span>
      </Link>
      <NavItem
        href="/messages"
        label="Messages"
        icon={<MessagesIcon />}
        active={isActive("/messages")}
        badge={unreadMessageCount}
      />
      <NavItem
        href={profile.href}
        label={profile.label}
        icon={profile.icon}
        active={isActive(profile.href)}
      />
    </nav>
  );
}

function NavItem({
  href,
  label,
  icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex flex-1 flex-col items-center justify-center gap-1 py-2.5 transition-colors",
        active ? "text-acid" : "text-paper-dim"
      )}
    >
      <span className="relative">
        {icon}
        {!!badge && (
          <span className="absolute -top-1 -right-2 flex h-3.5 min-w-3.5 items-center justify-center bg-acid px-1 font-mono text-[8px] font-bold text-acid-ink">
            {badge}
          </span>
        )}
      </span>
      <span className="font-mono text-[9px] uppercase tracking-wider">{label}</span>
    </Link>
  );
}
