// Support+ membership pricing — shared so the pricing page, checkout modal
// and any other CTA never drift apart.
export const SUPPORT_PLUS_MONTHLY_PRICE = 7.99;
export const SUPPORT_PLUS_ANNUAL_PRICE = 89.99;

const ANNUAL_SAVINGS = SUPPORT_PLUS_MONTHLY_PRICE * 12 - SUPPORT_PLUS_ANNUAL_PRICE;

export function supportPlusSavingsLabel(): string {
  return `Save £${ANNUAL_SAVINGS.toFixed(2)} a year vs paying monthly`;
}

export function supportPlusPrice(period: "monthly" | "annual"): number {
  return period === "annual" ? SUPPORT_PLUS_ANNUAL_PRICE : SUPPORT_PLUS_MONTHLY_PRICE;
}
