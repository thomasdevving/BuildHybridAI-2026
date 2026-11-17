import { shared } from "../shared";

function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\s+/g, " ");
}

/**
 * Case-insensitive phrase match on any free text (docs/05 §5.3). Runs before and
 * independent of any model call. Deliberately broad.
 */
export function detectCrisis(text: string, keywords: string[] = shared.safety.crisisKeywords): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  const t = norm(text);
  const loose = t.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ");
  for (const k of keywords) {
    const kn = norm(k);
    if (kn.length === 0) continue;
    if (t.includes(kn)) return true;
    const kl = kn.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    if (kl.length > 0 && loose.includes(kl)) return true;
  }
  return false;
}
