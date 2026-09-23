import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-mono uppercase tracking-wide transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap";

const variants: Record<Variant, string> = {
  primary: "bg-acid text-acid-ink hover:bg-paper",
  secondary: "bg-paper text-ink hover:bg-acid",
  ghost: "bg-transparent text-paper hover:text-acid",
  outline:
    "bg-transparent text-paper border border-ink-border hover:border-paper",
  danger: "bg-transparent text-signal border border-signal/50 hover:bg-signal/10",
};

const sizes: Record<Size, string> = {
  sm: "text-[11px] px-3 py-2",
  md: "text-xs px-5 py-3",
  lg: "text-sm px-7 py-4",
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  className?: string;
}

interface ButtonAsButton
  extends CommonProps,
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> {
  href?: undefined;
}

interface ButtonAsLink extends CommonProps {
  href: string;
  target?: string;
  rel?: string;
}

type ButtonProps = ButtonAsButton | ButtonAsLink;

export default function Button(props: ButtonProps) {
  const { variant = "primary", size = "md", children, className } = props;
  const cls = cn(base, variants[variant], sizes[size], className);

  if ("href" in props && props.href) {
    return (
      <Link href={props.href} className={cls} target={props.target} rel={props.rel}>
        {children}
      </Link>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { href: _href, variant: _v, size: _s, className: _c, children: _ch, ...rest } =
    props as ButtonAsButton;
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
