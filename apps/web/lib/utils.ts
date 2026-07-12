/**
 * Format an integer amount of US cents as a USD currency string.
 *
 * @example formatUsd(123456) // "$1,234.56"
 */
export function formatUsd(cents: number): string {
  if (!Number.isFinite(cents)) {
    throw new TypeError("formatUsd expects a finite number of cents");
  }
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });
  return formatter.format(cents / 100);
}
