import type { Config, PhqReference, QuestionnaireId, QuestionnaireRecord, QuestionnaireResult } from "./types";
import { shared } from "./shared";
import { median } from "./stats";
import { dateOfTimestamp, daysBetween } from "./time";

const ITEM_COUNT: Record<QuestionnaireId, number> = { PHQ2: 2, PHQ9: 9, GAD2: 2, WHO5: 5 };
const MAX_ANSWER: Record<QuestionnaireId, number> = { PHQ2: 3, PHQ9: 3, GAD2: 3, WHO5: 5 };

export function phq9Band(total: number): string | null {
  const band = shared.questionnaires.PHQ9.scoring.bands?.find((b) => total >= b.min && total <= b.max);
  return band ? band.id : null;
}

/**
 * Scoring and decisions (docs/06 §3). The model never does this (rule R2).
 * Throws on a wrong number of answers or an answer outside its range.
 */
export function scoreQuestionnaire(id: QuestionnaireId, answers: number[], ref: PhqReference, cfg: Config): QuestionnaireResult {
  const n = ITEM_COUNT[id];
  if (n === undefined) throw new Error(`unknown questionnaire ${id}`);
  if (!Array.isArray(answers) || answers.length !== n) throw new Error(`${id} needs ${n} answers`);
  for (const a of answers) {
    if (!Number.isInteger(a) || a < 0 || a > MAX_ANSWER[id]) throw new Error(`${id} answer out of range: ${a}`);
  }
  let total = answers.reduce((s, a) => s + a, 0);
  if (id === "WHO5") total *= 4;
  const result: QuestionnaireResult = { id, total, band: null, positive: false, flagged: false, changeFromReference: null, safetyItemPositive: false, nextStep: "none" };
  if (id === "PHQ2") {
    result.positive = total >= cfg.phq2Cutoff;
    result.nextStep = result.positive ? "offer_phq9" : "none";
  } else if (id === "PHQ9") {
    result.band = phq9Band(total);
    const change = ref.remissionScore === null ? null : total - ref.remissionScore;
    result.changeFromReference = change;
    result.flagged = total >= cfg.phq9Cutoff || (change !== null && change >= cfg.phq9ReliableChange);
    result.safetyItemPositive = answers[8] > 0;
    result.nextStep = result.safetyItemPositive ? "safety" : result.flagged ? "show_plan_and_share" : "none";
  } else if (id === "GAD2") {
    result.positive = total >= 3;
  }
  return result;
}

/**
 * The user's own reference (docs/06 §3.2): the median of the unflagged PHQ-9 totals of the
 * last 180 days, or the onboarding total until a second PHQ-9 exists.
 */
export function phqReference(records: QuestionnaireRecord[], today: string): PhqReference {
  const phq9 = records.filter((r) => r.instrument === "PHQ9").sort((a, b) => (a.takenAt < b.takenAt ? -1 : 1));
  if (phq9.length === 0) return { remissionScore: null };
  if (phq9.length === 1) return { remissionScore: phq9[0].result.total };
  const recent = phq9.filter((r) => !r.result.flagged && daysBetween(dateOfTimestamp(r.takenAt), today) <= 180 && dateOfTimestamp(r.takenAt) <= today);
  if (recent.length === 0) return { remissionScore: phq9[0].result.total };
  return { remissionScore: median(recent.map((r) => r.result.total)) };
}
