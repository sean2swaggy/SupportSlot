// Pure validation for the account-level username (see 0017_username.sql —
// shared by both roles, case-insensitively unique). Kept separate from any
// Supabase client so the format rule can be unit tested and reused for the
// live availability check and the final submit in one place.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

export function validateUsernameFormat(username: string): { ok: true } | { ok: false; error: string } {
  if (username.length < USERNAME_MIN_LENGTH) {
    return { ok: false, error: `At least ${USERNAME_MIN_LENGTH} characters.` };
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    return { ok: false, error: `At most ${USERNAME_MAX_LENGTH} characters.` };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, error: "Only letters, numbers and underscores." };
  }
  return { ok: true };
}
