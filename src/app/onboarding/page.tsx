"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/layout/Logo";
import Button from "@/components/ui/Button";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { validateUsernameFormat } from "@/lib/username";
import EmailVerifyPanel from "@/components/account/EmailVerifyPanel";
import AvatarUploadField from "@/components/ui/AvatarUploadField";

const GENRES = [
  "Alternative", "Electronic", "Indie", "Experimental", "Hip-Hop",
  "Punk", "Folk", "Pop", "R&B", "Techno", "Drum & Bass", "Rock",
];
const CITIES = ["London", "Manchester", "Birmingham", "Bristol", "Leeds", "Brighton"];
const MINIMUM_AGE = 16;

function OnboardingInner() {
  const router = useRouter();
  const {
    role,
    accountEmail,
    emailVerified,
    markEmailVerified,
    completeOnboarding,
    artistAvatar,
    setArtistAvatar,
    promoterAvatar,
    setPromoterAvatar,
  } = useStore();

  // role comes from the account created at signup (see src/app/login/page.tsx)
  // — it's fixed, not chosen here, so there's no "which are you?" step.
  const type = role;

  const [step, setStep] = useState(1);
  const [dob, setDob] = useState("");
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >("idle");
  const [name, setName] = useState("");
  const [city, setCity] = useState(CITIES[0]);
  const [genres, setGenres] = useState<string[]>([]);
  const [spotify, setSpotify] = useState("");
  const [instagram, setInstagram] = useState("");
  const [bio, setBio] = useState("");
  const [company, setCompany] = useState("");
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(
    emailVerified ? accountEmail : null
  );
  const [finished, setFinished] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // The latest date of birth that still qualifies as MINIMUM_AGE or older,
  // computed once via a lazy initializer so we never call `new Date()` during
  // render (react-hooks/purity).
  const [maxBirthDate] = useState(() => {
    const now = new Date();
    const cutoff = new Date(now.getFullYear() - MINIMUM_AGE, now.getMonth(), now.getDate());
    return cutoff.toISOString().slice(0, 10);
  });
  const isOldEnough = dob !== "" && dob <= maxBirthDate;

  // Debounced live availability check. Everything — including the "invalid
  // format" / "checking" states — happens after the debounce's own await,
  // so there's no synchronous setState in the effect body (this codebase's
  // eslint config flags that; see the `load` pattern elsewhere in this repo
  // for the same fix). The `cancelled` flag is the staleness guard: a
  // slower, superseded check bails out instead of overwriting a newer one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (cancelled) return;

      const format = validateUsernameFormat(username);
      if (!format.ok) {
        setUsernameStatus(username === "" ? "idle" : "invalid");
        return;
      }

      setUsernameStatus("checking");
      const supabase = createClient();
      const { data, error } = await supabase.rpc("is_username_available", { p_username: username });
      if (cancelled) return;
      if (error) {
        setUsernameStatus("idle");
        return;
      }
      setUsernameStatus(data ? "available" : "taken");
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  const usernameFormatResult = validateUsernameFormat(username);
  const usernameFormatError = usernameFormatResult.ok ? null : usernameFormatResult.error;

  const totalSteps = type === "artist" ? 5 : 4;
  const toggleGenre = (g: string) =>
    setGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));

  const finish = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      if (verifiedEmail) markEmailVerified(verifiedEmail);
      if (type === "artist") {
        await completeOnboarding({
          role: "artist",
          username,
          name,
          city,
          genres,
          spotifyUrl: spotify,
          instagramUrl: instagram,
          bio,
        });
      } else {
        await completeOnboarding({
          role: "promoter",
          username,
          company,
          city,
        });
      }
      setFinished(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const goDashboard = () => {
    router.push(type === "artist" ? "/dashboard/artist" : "/dashboard/promoter");
  };

  if (finished) {
    return (
      <div className="mx-auto flex min-h-[80vh] max-w-[460px] flex-col items-center justify-center px-4 sm:px-0 text-center">
        <div className="flex h-16 w-16 items-center justify-center border border-acid text-acid">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path d="M4 12.5 9.5 18 20 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="font-display text-3xl mt-6">
          {type === "artist" ? `Welcome, ${name || "artist"}.` : `Welcome, ${company || "promoter"}.`}
        </p>
        <p className="mt-3 text-paper-dim max-w-[42ch]">
          {type === "artist"
            ? "Your profile is set up. Start browsing support slots that fit your sound."
            : "Your promoter account is ready. Post your first support slot in minutes."}
        </p>
        <Button size="lg" className="mt-8" onClick={goDashboard}>
          Go to your dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[560px] px-4 sm:px-0 py-14 sm:py-20">
      <div className="flex justify-center mb-10">
        <Logo />
      </div>

      <div className="flex items-center gap-1.5 mb-10">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <span
            key={i}
            className={cn("h-1 flex-1", i + 1 <= step ? "bg-acid" : "bg-ink-border")}
          />
        ))}
      </div>

      {step === 1 && (
        <Step title="Set up your account" subtitle={`Choose a username, and confirm you're at least ${MINIMUM_AGE}.`}>
          <Field label="Username">
            <input
              className={fieldCls}
              value={username}
              onChange={(e) => setUsername(e.target.value.trim())}
              placeholder="e.g. slowcpu"
              maxLength={20}
            />
            {usernameStatus !== "idle" && (
              <p
                className={cn(
                  "mt-2 text-xs",
                  usernameStatus === "available" ? "text-ok" : usernameStatus === "checking" ? "text-paper-dim" : "text-signal"
                )}
              >
                {usernameStatus === "checking" && "Checking availability…"}
                {usernameStatus === "available" && "Available ✓"}
                {usernameStatus === "taken" && "That username is already taken."}
                {usernameStatus === "invalid" && usernameFormatError}
              </p>
            )}
          </Field>
          <Field label="Date of birth">
            <input
              type="date"
              className={fieldCls}
              value={dob}
              max={maxBirthDate}
              onChange={(e) => setDob(e.target.value)}
            />
          </Field>
          {dob !== "" && !isOldEnough && (
            <p className="text-xs text-signal">
              You must be at least {MINIMUM_AGE} years old to create a Support Slot account.
            </p>
          )}
          <Button
            size="lg"
            className="w-full mt-2"
            disabled={!isOldEnough || usernameStatus !== "available"}
            onClick={() => setStep(2)}
          >
            Continue
          </Button>
        </Step>
      )}

      {step === 2 && type === "artist" && (
        <Step title="Tell us about your project" subtitle="Solo artist or full band — either works.">
          <Field label="Profile photo">
            <AvatarUploadField
              value={artistAvatar}
              onChange={setArtistAvatar}
              alt={name || "Your profile photo"}
              size={88}
            />
          </Field>
          <Field label="Artist / band name">
            <input
              className={fieldCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. slowcpu"
            />
          </Field>
          <Field label="Based in">
            <select className={cn(fieldCls, "appearance-none")} value={city} onChange={(e) => setCity(e.target.value)}>
              {CITIES.map((c) => (
                <option key={c} value={c} className="bg-ink-card">
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Genres">
            <div className="flex flex-wrap gap-2">
              {GENRES.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => toggleGenre(g)}
                  className={cn(
                    "font-mono text-[10px] uppercase tracking-widest px-3 py-2 border transition-colors",
                    genres.includes(g) ? "border-acid text-acid" : "border-ink-border text-paper-dim hover:border-paper"
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
          </Field>
          <StepNav onBack={() => setStep(1)} onNext={() => setStep(3)} disabled={!name} />
        </Step>
      )}

      {step === 3 && type === "artist" && (
        <Step title="Link your platforms" subtitle="Helps promoters check you out before booking.">
          <Field label="Spotify artist link">
            <input className={fieldCls} value={spotify} onChange={(e) => setSpotify(e.target.value)} placeholder="open.spotify.com/artist/..." />
          </Field>
          <Field label="Instagram">
            <input className={fieldCls} value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@yourname" />
          </Field>
          <StepNav onBack={() => setStep(2)} onNext={() => setStep(4)} />
        </Step>
      )}

      {step === 4 && type === "artist" && (
        <Step title="Add a short bio" subtitle="A couple of sentences is plenty.">
          <Field label="Biography">
            <textarea
              className={fieldCls}
              rows={4}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell promoters what your live show is like..."
            />
          </Field>
          <StepNav onBack={() => setStep(3)} onNext={() => setStep(5)} />
        </Step>
      )}

      {step === 5 && type === "artist" && (
        <Step title="Verify your email" subtitle="Last step — confirm your email to protect your account.">
          <EmailVerifyPanel initialEmail={verifiedEmail ?? accountEmail ?? ""} onVerified={setVerifiedEmail} />
          {verifiedEmail && (
            <p className="font-mono text-[11px] uppercase tracking-widest text-ok">
              {verifiedEmail} verified ✓
            </p>
          )}
          {submitError && <p className="text-xs text-signal">{submitError}</p>}
          <StepNav
            onBack={() => setStep(4)}
            onNext={finish}
            nextLabel={submitting ? "Finishing…" : "Finish setup"}
            disabled={!verifiedEmail || submitting}
          />
        </Step>
      )}

      {step === 2 && type === "promoter" && (
        <Step title="Your promoter details" subtitle="This appears on every slot you post.">
          <Field label="Profile photo">
            <AvatarUploadField
              value={promoterAvatar}
              onChange={setPromoterAvatar}
              alt={company || "Your profile photo"}
              size={88}
            />
          </Field>
          <Field label="Company / collective name">
            <input className={fieldCls} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Bedroom Sound Presents" />
          </Field>
          <Field label="Based in">
            <select className={cn(fieldCls, "appearance-none")} value={city} onChange={(e) => setCity(e.target.value)}>
              {CITIES.map((c) => (
                <option key={c} value={c} className="bg-ink-card">
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <StepNav onBack={() => setStep(1)} onNext={() => setStep(3)} disabled={!company} />
        </Step>
      )}

      {step === 3 && type === "promoter" && (
        <Step title="You're almost done" subtitle="Verification badges are added once we confirm your venue or promotion history.">
          <div className="border border-ink-border p-5">
            <p className="text-sm">
              <span className="text-paper">{company || "Your promoter account"}</span> — {city}
            </p>
            <p className="text-xs text-paper-dim mt-1">
              You&rsquo;ll be able to post support slots immediately, with a verified badge pending review.
            </p>
          </div>
          <StepNav onBack={() => setStep(2)} onNext={() => setStep(4)} />
        </Step>
      )}

      {step === 4 && type === "promoter" && (
        <Step title="Verify your email" subtitle="Last step — confirm your email to protect your account.">
          <EmailVerifyPanel initialEmail={verifiedEmail ?? accountEmail ?? ""} onVerified={setVerifiedEmail} />
          {verifiedEmail && (
            <p className="font-mono text-[11px] uppercase tracking-widest text-ok">
              {verifiedEmail} verified ✓
            </p>
          )}
          {submitError && <p className="text-xs text-signal">{submitError}</p>}
          <StepNav
            onBack={() => setStep(3)}
            onNext={finish}
            nextLabel={submitting ? "Finishing…" : "Finish setup"}
            disabled={!verifiedEmail || submitting}
          />
        </Step>
      )}
    </div>
  );
}

const fieldCls =
  "w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60";

function Step({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h1 className="font-display text-2xl sm:text-3xl">{title}</h1>
      <p className="text-sm text-paper-dim mt-2 mb-8">{subtitle}</p>
      <div className="space-y-6">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
        {label}
      </label>
      {children}
    </div>
  );
}

function StepNav({
  onBack,
  onNext,
  disabled,
  nextLabel = "Continue",
}: {
  onBack: () => void;
  onNext: () => void;
  disabled?: boolean;
  nextLabel?: string;
}) {
  return (
    <div className="flex gap-3 pt-2">
      <Button variant="outline" size="lg" onClick={onBack}>
        Back
      </Button>
      <Button size="lg" className="flex-1" onClick={onNext} disabled={disabled}>
        {nextLabel}
      </Button>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingInner />
    </Suspense>
  );
}
