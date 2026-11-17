import type { Config } from "../types";
import { defaultConfig } from "../config";
import { checkNumbers, checkPii, hasBannedWords, wordCount } from "./checks";
import { verifyContext, verifyMarkers, verifyPlan } from "./plan";
import { verifyQuote } from "./quotes";
import { validate, type SchemaId } from "./validate";

export interface TaskCheckContext {
  input?: unknown; // the facts given to the model (number check)
  sourceText?: string; // the user's text (quote verification)
  today?: string;
  cfg?: Config;
  variant?: "full" | "lite";
  knownIds?: string[]; // action ids (K) or personal item ids (I)
  placeLabels?: string[];
  trustedContactName?: string | null;
}
export type TaskCheck = { ok: true; value: unknown } | { ok: false; error: string };

// Words that would turn a check-in opening into a question about symptoms (task A).
const SYMPTOM_TERMS = ["sleep", "appetite", "hopeless", "worthless", "suicid", "sad", "tired", "fatigue", "concentrat", "anxious", "anxiety", "mood"];

const fail = (error: string): TaskCheck => ({ ok: false, error });

/**
 * Code-side validation of one structured model output (rule R8): schema first, then the
 * guardrails of docs/05 §4–5 for that task. Invalid output is discarded by the caller.
 */
export function verifyTaskOutput(step: SchemaId, raw: unknown, ctx: TaskCheckContext = {}): TaskCheck {
  const schema = validate(step, raw);
  if (!schema.valid) return fail(`schema: ${schema.errors.join("; ")}`);
  const cfg = ctx.cfg ?? defaultConfig;
  const prose = (text: string, maxWords: number | null): string | null => {
    if (hasBannedWords(text)) return "banned word";
    if (!checkNumbers(text, ctx.input ?? {}).ok) return "number not in input";
    if (maxWords !== null && wordCount(text) > maxWords) return "too long";
    return null;
  };
  switch (step) {
    case "A": {
      const a = raw as { intro: string; tone: string };
      const err = prose(a.intro, null);
      if (err) return fail(err);
      const lower = a.intro.toLowerCase();
      if (SYMPTOM_TERMS.some((t) => new RegExp(`\\b${t}`).test(lower))) return fail("asks about symptoms");
      if (a.intro.trim().length === 0) return fail("empty");
      return { ok: true, value: a };
    }
    case "B": {
      const m = verifyMarkers(raw);
      return m ? { ok: true, value: m } : fail("schema");
    }
    case "C": {
      const c = raw as { explanation: string };
      const err = prose(c.explanation, 80);
      return err ? fail(err) : { ok: true, value: c };
    }
    case "D": {
      const d = raw as { reflection: string; open_question: string };
      const err = prose(d.reflection, ctx.variant === "lite" ? 60 : 250) ?? prose(d.open_question, null);
      return err ? fail(err) : { ok: true, value: d };
    }
    case "E": {
      const e = raw as { summary: string; timeline: { iso_week: string; note: string }[]; questions_to_bring: string[] };
      const err = prose(e.summary, 120) ?? e.timeline.map((t) => prose(t.note, null)).find((x) => x) ?? e.questions_to_bring.map((q) => prose(q, null)).find((x) => x) ?? null;
      return err ? fail(err) : { ok: true, value: e };
    }
    case "G": {
      const plan = verifyPlan(raw, ctx.sourceText ?? "", { phoneEnabled: cfg.phone.enabled });
      return plan.valid ? { ok: true, value: plan } : fail("schema");
    }
    case "H":
      return { ok: true, value: verifyContext(raw, ctx.sourceText ?? "", ctx.today ?? "1970-01-01", cfg) };
    case "I": {
      const i = raw as { answers: { item_id: string; answer: string; quote: string }[] };
      const known = new Set(ctx.knownIds ?? []);
      const answers = i.answers
        .filter((a) => known.has(a.item_id))
        .map((a) => (a.answer !== "not_mentioned" && !verifyQuote(a.quote, ctx.sourceText ?? "") ? { ...a, answer: "not_mentioned", quote: "" } : a));
      return { ok: true, value: { answers } };
    }
    case "K": {
      const k = raw as { action_ids: string[] };
      const known = new Set(ctx.knownIds ?? []);
      if (k.action_ids.some((id) => !known.has(id))) return fail("unknown action id");
      return { ok: true, value: { action_ids: [...new Set(k.action_ids)] } };
    }
    case "P": {
      const p = raw as { themes: string[]; note: string };
      const pii = checkPii(p.note, { placeLabels: ctx.placeLabels, trustedContactName: ctx.trustedContactName });
      if (!pii.ok) return fail(`pii: ${pii.reasons.join(",")}`);
      if (hasBannedWords(p.note)) return fail("banned word");
      return { ok: true, value: p };
    }
    case "Q_classify":
      return { ok: true, value: raw };
    case "Q_phrase": {
      const q = raw as { answer: string };
      const err = prose(q.answer, 60);
      return err ? fail(err) : { ok: true, value: q };
    }
  }
}
