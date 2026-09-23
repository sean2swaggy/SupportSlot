import Link from "next/link";
import Logo from "./Logo";

export default function Footer() {
  return (
    <footer className="border-t border-ink-border mt-24 mb-16 lg:mb-0">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-4 max-w-[26ch] text-sm text-paper-dim">
              A marketplace for support slots — built for independent and underground artists.
            </p>
          </div>
          <FooterCol
            title="Platform"
            links={[
              { href: "/discover", label: "Find a Slot" },
              { href: "/last-minute", label: "Last-Minute Support" },
              { href: "/support-plus", label: "Support+" },
              { href: "/create-slot", label: "Post a Slot" },
            ]}
          />
          <FooterCol
            title="Artists"
            links={[
              { href: "/dashboard/artist", label: "Dashboard" },
              { href: "/discover", label: "Find a Slot" },
              { href: "/onboarding?type=artist", label: "Join as an Artist" },
            ]}
          />
          <FooterCol
            title="Trust & Safety"
            links={[
              { href: "/trust", label: "No Pay-to-Play Policy" },
              { href: "/privacy", label: "Privacy Policy" },
              { href: "/terms", label: "Terms of Service" },
            ]}
          />
        </div>
        <div className="mt-14 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-t border-ink-border pt-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
            © {new Date().getFullYear()} Support Slot — prototype build
          </p>
          <p className="font-mono text-[10px] uppercase tracking-widest text-acid">
            No pay-to-play. Ever.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-4">
        {title}
      </p>
      <ul className="space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            <Link href={l.href} className="text-sm hover:text-acid transition-colors">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
