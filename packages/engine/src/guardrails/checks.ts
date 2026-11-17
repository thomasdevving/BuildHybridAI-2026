import { shared } from "../shared";

const NUMBER_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/** All numbers written with digits in a text, as absolute values. "8,500" → 8500. */
export function extractNumbers(text: string): number[] {
  return (text.match(NUMBER_RE) ?? []).map((m) => Number(m.replace(/,/g, ""))).filter((n) => Number.isFinite(n));
}

/** Every number that appears anywhere in a facts object: number values and digits inside strings and keys. */
export function numbersInFacts(facts: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(Math.abs(v), ...extractNumbers(String(Math.abs(v))));
    else if (typeof v === "string") out.push(...extractNumbers(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        out.push(...extractNumbers(k));
        walk(x);
      }
    }
  };
  walk(facts);
  return out;
}

/** Number check (docs/05 §5.2): every number in the model's text must be present in the input facts. */
export function checkNumbers(text: string, facts: unknown): { ok: boolean; unknown: number[] } {
  const allowed = numbersInFacts(facts);
  const unknown = extractNumbers(text).filter((n) => !allowed.some((a) => Math.abs(a - n) < 1e-9));
  return { ok: unknown.length === 0, unknown };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Banned words found in model-written prose (docs/05 §5.4): case-insensitive, whole words or phrases. */
export function findBannedWords(text: string, words: string[] = shared.safety.bannedWords): string[] {
  const t = text.normalize("NFKC").toLowerCase();
  return words.filter((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w.toLowerCase()).replace(/\s+/g, "\\s+")}($|[^\\p{L}\\p{N}])`, "u").test(t));
}

export function hasBannedWords(text: string, words?: string[]): boolean {
  return findBannedWords(text, words).length > 0;
}

export function wordCount(text: string): number {
  const t = text.trim();
  return t.length === 0 ? 0 : t.split(/\s+/).length;
}

/**
 * PII check for a privacy-gateway note (docs/05 task P). Rejects a digit, an "@", a
 * capitalised word that is not sentence-initial (the pronoun "I" is allowed), any place
 * label and the trusted contact's name.
 */
export function checkPii(note: string, opts: { placeLabels?: string[]; trustedContactName?: string | null } = {}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (/\d/.test(note)) reasons.push("digit");
  if (note.includes("@")) reasons.push("at_sign");
  const lower = note.toLowerCase();
  for (const label of opts.placeLabels ?? []) {
    if (label.trim().length > 0 && new RegExp(`(^|[^\\p{L}])${escapeRe(label.trim().toLowerCase())}($|[^\\p{L}])`, "u").test(lower)) reasons.push("place_label");
  }
  const name = opts.trustedContactName?.trim();
  if (name) {
    for (const part of name.toLowerCase().split(/\s+/)) {
      if (part.length >= 2 && new RegExp(`(^|[^\\p{L}])${escapeRe(part)}($|[^\\p{L}])`, "u").test(lower)) reasons.push("contact_name");
    }
  }
  const tokens = note.match(/[\p{L}][\p{L}'’-]*|[.!?]+/gu) ?? [];
  let sentenceStart = true;
  for (const tok of tokens) {
    if (/^[.!?]+$/.test(tok)) {
      sentenceStart = true;
      continue;
    }
    const isCapital = /^\p{Lu}/u.test(tok);
    const isPronounI = /^I(['’](m|ve|d|ll))?$/.test(tok);
    if (isCapital && !sentenceStart && !isPronounI) reasons.push("capitalised_word");
    sentenceStart = false;
  }
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}
