import type { Config, ContextLabel, DiaryMarkers, RuleDirection, VerifiedContext, VerifiedPlan, VerifiedRule } from "../types";
import { defaultConfig } from "../config";
import { CONTEXT_TABLE } from "../context";
import { featureDef } from "../features/catalogue";
import { addDays } from "../time";
import { hasBannedWords } from "./checks";
import { resolveDateHint } from "./dates";
import { verifyQuote } from "./quotes";
import { validate } from "./validate";

interface RawG {
  rules: { feature: string; direction: RuleDirection; place_label: string; quote: string }[];
  personal_checkin_items: { question: string; quote: string }[];
  actions: { text: string; quote: string }[];
}

function directionLegal(feature: string, direction: RuleDirection): boolean {
  if (direction === "later" || direction === "earlier") return feature === "rest_midpoint";
  if (direction === "less_regular") return feature === "rest_regularity" || feature === "rhythm_stability";
  return true;
}

/**
 * Task G guardrails (docs/05 §4 G): schema, quote verification, legal directions, merged
 * duplicates. What survives becomes cards for the user to accept or reject.
 * Rules on phone-domain features are removed unless the phone domain is enabled.
 */
export function verifyPlan(raw: unknown, sourceText: string, opts: { phoneEnabled?: boolean } = {}): VerifiedPlan {
  const empty: VerifiedPlan = { rules: [], personal_checkin_items: [], actions: [], dropped: 0, valid: false };
  if (!validate("G", raw).valid) return empty;
  const g = raw as RawG;
  let dropped = 0;

  const rules: VerifiedRule[] = [];
  const seen = new Set<string>();
  for (const r of g.rules) {
    const def = featureDef(r.feature);
    const label = r.feature === "place_visits" ? r.place_label.trim().toLowerCase() : "";
    if (!def || !verifyQuote(r.quote, sourceText) || !directionLegal(r.feature, r.direction) || (r.feature === "place_visits" && label === "")) {
      dropped++;
      continue;
    }
    if (def.domain === "phone" && !opts.phoneEnabled) continue; // not measurable here; not an invention
    const key = `${r.feature}|${label}`;
    if (seen.has(key)) continue; // duplicates are merged, the first quote wins
    seen.add(key);
    rules.push({ feature: r.feature, direction: r.direction, place_label: label === "" ? null : label, quote: r.quote });
  }

  const personal_checkin_items: VerifiedPlan["personal_checkin_items"] = [];
  const seenQ = new Set<string>();
  for (const it of g.personal_checkin_items) {
    const q = it.question.trim();
    if (q.length < 3 || !verifyQuote(it.quote, sourceText) || hasBannedWords(q)) {
      dropped++;
      continue;
    }
    if (seenQ.has(q.toLowerCase())) continue;
    seenQ.add(q.toLowerCase());
    personal_checkin_items.push({ question: q, quote: it.quote });
  }

  const actions: VerifiedPlan["actions"] = [];
  const seenA = new Set<string>();
  for (const a of g.actions) {
    const t = a.text.trim();
    if (t.length < 2 || !verifyQuote(a.quote, sourceText)) {
      dropped++;
      continue;
    }
    if (seenA.has(t.toLowerCase())) continue;
    seenA.add(t.toLowerCase());
    actions.push({ text: t, quote: a.quote });
  }
  return { rules, personal_checkin_items, actions, dropped, valid: true };
}

const CONF_RANK = { low: 0, medium: 1, high: 2 } as const;

/**
 * Task H guardrails (docs/05 §4 H). Dates are resolved here, never by the model; `kind`
 * comes from the table in docs/04 §6. Returns null when there is nothing to confirm.
 */
export function verifyContext(raw: unknown, sourceText: string, today: string, cfg: Config = defaultConfig): VerifiedContext | null {
  if (!validate("H", raw).valid) return null;
  const h = raw as { context: string; start_hint: string; end_hint: string; confidence: "low" | "medium" | "high"; quote: string };
  const def = CONTEXT_TABLE[h.context];
  if (!def) return null; // includes "none"
  if (!verifyQuote(h.quote, sourceText)) return null;
  if (CONF_RANK[h.confidence] < CONF_RANK[cfg.ctxMinConf]) return null;
  const startHint = resolveDateHint(h.start_hint, today, "start");
  const endHint = resolveDateHint(h.end_hint, today, "end");
  const start = startHint ?? today;
  let end = endHint ?? addDays(start > today ? start : today, 6);
  if (end < start) end = start;
  if (def.kind === "explains_sensors") {
    const cap = addDays(start, cfg.contextMaxDays - 1);
    if (end > cap) end = cap;
  }
  return { type: h.context, kind: def.kind, start, end, quote: h.quote, confidence: h.confidence, startResolved: startHint !== null, endResolved: endHint !== null };
}

/** Task B guardrail: schema only. Markers are stored and charted, never scored (rule R6). */
export function verifyMarkers(raw: unknown): DiaryMarkers | null {
  if (!validate("B", raw).valid) return null;
  const b = raw as DiaryMarkers;
  return {
    negative_affect: b.negative_affect,
    anhedonic_language: b.anhedonic_language,
    social_withdrawal: b.social_withdrawal,
    hopelessness: b.hopelessness,
    sleep_complaint: b.sleep_complaint,
    themes: [...new Set(b.themes)],
    crisis: b.crisis,
  };
}

/** A confirmed label from a verified context. */
export function contextLabelFrom(v: VerifiedContext, id: string, source: "model" | "manual" = "model"): ContextLabel {
  return { id, type: v.type, kind: v.kind, start: v.start, end: v.end, quote: v.quote || null, source, confirmed: true };
}
