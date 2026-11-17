import type { LanguageFeatures } from "./types";

const FPS = new Set(["i", "me", "my", "mine", "myself"]);
const OTH = new Set(["you", "your", "he", "she", "they", "we", "us", "them"]);
// Al-Mosaiwi & Johnstone, 19 words.
const ABS = new Set([
  "absolutely", "all", "always", "complete", "completely", "constant", "constantly", "definitely", "entire", "ever",
  "every", "everyone", "everything", "full", "must", "never", "nothing", "totally", "whole",
]);

/**
 * Deterministic language features (docs/03 §7). English only. Null under 20 tokens.
 * Display and reflection only: these never enter the deviation index (rule R6).
 */
export function languageFeatures(text: string): LanguageFeatures | null {
  if (typeof text !== "string") return null;
  const tokens = text.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 0);
  const W = tokens.length;
  if (W < 20) return null;
  let fps = 0;
  let oth = 0;
  let abs = 0;
  for (const t of tokens) {
    if (FPS.has(t)) fps++;
    if (OTH.has(t)) oth++;
    if (ABS.has(t)) abs++;
  }
  const FPSv = fps / W;
  const OTHv = oth / W;
  return { W, FPS: FPSv, OTH: OTHv, ABS: abs / W, SF: FPSv / (FPSv + OTHv + 1e-6) };
}
