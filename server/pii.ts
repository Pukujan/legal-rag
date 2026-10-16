/**
 * Anonymisation applied before a question is ever written to the query log.
 * Removes email addresses, phone numbers and long runs of digits.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** +1 (555) 123-4567, 555.123.4567, 5551234567, (555) 555-5555 ext. 22 */
const PHONE =
  /(?:\+?\d{1,2}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?:[\s.]?(?:ext|extension|x|转)[\s.]?\d{1,6})?/gi;

/** Any run of 7 or more digits, possibly separated by spaces, dots or dashes. */
const LONG_DIGITS = /\d(?:[\s.()-]*\d){6,}/g;

const REDACTED = "[removed]";

export function scrubIdentifiers(text: string): string {
  let out = text;
  out = out.replace(EMAIL, REDACTED);
  out = out.replace(LONG_DIGITS, REDACTED);
  out = out.replace(PHONE, REDACTED);
  // Collapse whitespace left behind by the replacements.
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1");
  return out.trim();
}

export function scrubQuestion(text: string, maxChars = 320): string {
  const cleaned = scrubIdentifiers(text.replace(/\s+/g, " ")).trim();
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, maxChars - 1).trimEnd() + "…";
}
