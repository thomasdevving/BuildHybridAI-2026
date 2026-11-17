/** Lowercase, NFKC, every run of non-alphanumeric characters → one space, trimmed (docs/05 §5.1). */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A quote is valid when it has at least 3 characters and occurs in the source after normalisation. */
export function verifyQuote(quote: unknown, sourceText: string): boolean {
  if (typeof quote !== "string") return false;
  const q = normalizeText(quote);
  if (q.length < 3) return false;
  return normalizeText(sourceText).includes(q);
}
