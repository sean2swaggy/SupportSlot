/** Money is integer pence. */
export function pounds(pence: number): string {
  if (pence <= 0) return "No fee";
  const p = Math.round(pence);
  return p % 100 === 0 ? `£${p / 100}` : `£${(p / 100).toFixed(2)}`;
}

/** Parse a pounds input ("80", "80.50") into pence; null if invalid. */
export function toPence(input: string): number | null {
  const t = input.trim().replace(/^£/, "");
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}
