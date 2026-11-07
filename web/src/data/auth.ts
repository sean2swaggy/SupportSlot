/** Local demo password hashing (SHA-256 + salt). This only protects against
 *  casual reading of browser storage. Real auth belongs to Supabase. */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const newSalt = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const DEMO_PASSWORD = "demo1234";
export const DEMO_EMAILS: Record<string, string> = {
  "u-maya": "maya@example.test",
  "u-orchard": "orchard@example.test",
  "u-harbour": "harbour@example.test",
  "u-north": "north@example.test",
};
