/** Pure helpers for the PWA, kept out of main.js so Node tests can import them. */

/** Compact token count as DSH shows it: 517 / 12.2K / 517K / 1.2M. */
export function formatTokens(value) {
  const scaled = (n) => (n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
  if (value < 1e3) return String(value);
  if (value < 1e6) return `${scaled(value / 1e3)}K`;
  return `${scaled(value / 1e6)}M`;
}
