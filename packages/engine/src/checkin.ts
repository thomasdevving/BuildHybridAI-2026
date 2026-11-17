import type { CheckinInput, CheckinOutput, TaskId } from "./types";
import { detectCrisis } from "./guardrails/crisis";
import { languageFeatures } from "./language";
import { momentarySignal, phq2CooldownOver } from "./state";

/**
 * Called when a check-in is saved: crisis keywords on the free text (before and
 * independent of any model), the momentary rule of docs/04 §7.3, language features, and
 * which on-device tasks to run on the text.
 */
export function onCheckinCompleted(input: CheckinInput): CheckinOutput {
  const { record, freeText, cfg } = input;
  const text = freeText && freeText.trim().length > 0 ? freeText : null;
  const crisis = text !== null && detectCrisis(text, input.keywords);
  const a = record.answers;
  const momentaryHigh = (typeof a.mood_low === "number" && a.mood_low >= cfg.emaHigh) || (typeof a.enjoyment === "number" && a.enjoyment <= cfg.emaLow);
  const all = input.recentCheckins.some((c) => c.id === record.id) ? input.recentCheckins : [...input.recentCheckins, record];
  const offerPhq2 = input.state !== "CONFIRMED" && momentarySignal(all, input.date, cfg) && phq2CooldownOver(input.questionnaires, input.date, cfg);
  const runTasks: TaskId[] = text !== null ? ["H", "B"] : [];
  return { crisis, momentaryHigh, offerPhq2, language: text !== null ? languageFeatures(text) : null, runTasks };
}
