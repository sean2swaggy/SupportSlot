import { DEFAULT_FALLBACK } from "@/components/ui/AvatarUploadField";

/**
 * Plain artist profile picture. `src` is always live data from the DB now
 * (see src/lib/queries.ts), so this no longer needs to check against a
 * locally-uploaded override — kept as its own component so callers don't
 * need to change. Falls back to a neutral placeholder for a freshly
 * onboarded artist who hasn't uploaded a photo yet.
 */
export default function ArtistAvatarImage({
  src,
  alt,
  className,
}: {
  artistId: string;
  src: string;
  alt: string;
  className?: string;
}) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src || DEFAULT_FALLBACK} alt={alt} className={className} />;
}
