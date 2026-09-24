// Pure password-strength scoring — no framework/Supabase dependency, so the
// rule itself is unit testable and reused identically by the live meter and
// the submit-time gate on the signup form.

export const PASSWORD_MIN_LENGTH = 8;

// Small blocklist of the most common breached/guessable passwords — not
// exhaustive (that needs a real breach-list API, out of scope here), just
// enough to stop the most obvious cases length+variety rules alone wouldn't.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789",
  "1234567890", "qwerty123", "qwertyuiop", "letmein123", "welcome123",
  "admin1234", "iloveyou1", "111111111", "abc123456", "changeme1",
]);

export type PasswordScore = 0 | 1 | 2 | 3 | 4;

export interface PasswordStrength {
  score: PasswordScore;
  label: "Very weak" | "Weak" | "Fair" | "Good" | "Strong";
  // Non-empty while the password doesn't yet meet the minimum bar to submit.
  blockingIssues: string[];
}

const LABELS: Record<PasswordScore, PasswordStrength["label"]> = {
  0: "Very weak",
  1: "Weak",
  2: "Fair",
  3: "Good",
  4: "Strong",
};

function characterClassCount(password: string): number {
  let classes = 0;
  if (/[a-z]/.test(password)) classes++;
  if (/[A-Z]/.test(password)) classes++;
  if (/[0-9]/.test(password)) classes++;
  if (/[^a-zA-Z0-9]/.test(password)) classes++;
  return classes;
}

export function evaluatePassword(password: string): PasswordStrength {
  const blockingIssues: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    blockingIssues.push(`At least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    blockingIssues.push("That password is too common — pick something less guessable.");
  }
  const classes = characterClassCount(password);
  if (password.length >= PASSWORD_MIN_LENGTH && classes < 2) {
    blockingIssues.push("Mix in at least two of: lowercase, uppercase, numbers, symbols.");
  }

  // Score is informational (drives the meter's fill/label) — length carries
  // most of the weight, since it matters more for real-world strength than
  // complexity does, with character variety and a long-password bonus on top.
  let score: PasswordScore = 0;
  if (password.length >= PASSWORD_MIN_LENGTH) score = 1;
  if (password.length >= PASSWORD_MIN_LENGTH && classes >= 2) score = 2;
  if (password.length >= PASSWORD_MIN_LENGTH && classes >= 3) score = 3;
  if (password.length >= 12 && classes >= 3) score = 4;
  if (COMMON_PASSWORDS.has(password.toLowerCase())) score = 0;

  return { score, label: LABELS[score], blockingIssues };
}

export function isPasswordAcceptable(password: string): boolean {
  return evaluatePassword(password).blockingIssues.length === 0;
}
