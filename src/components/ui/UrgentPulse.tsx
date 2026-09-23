export default function UrgentPulse({ label = "Live" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-signal">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
      </span>
      {label}
    </span>
  );
}
