import type {
  Action,
  CheckinRecord,
  Config,
  ContextLabel,
  DayRecord,
  EngineState,
  PersonalItem,
  PlanAction,
  PlanRule,
  QuestionnaireRecord,
  ReplayData,
  ScriptEvent,
} from "../types";
import { defaultConfig } from "../config";
import { onCheckinCompleted } from "../checkin";
import { contextLabelFrom, verifyContext, verifyPlan } from "../guardrails/plan";
import { pickPlace } from "../places";
import { phqReference, scoreQuestionnaire } from "../questionnaires";
import { applyQuestionnaireResult, dailyUpdate, initialState } from "../state";
import { addDays, daysBetween } from "../time";

// A headless run of the replay: the real engine, with the persona's scripted answers
// standing in for the user and the scripted "correct model output" standing in for the
// on-device model (still passed through the real guardrails). Used by the end-to-end
// tests, the evaluation scripts and the web time machine's fast-forward.

export interface ReplayOptions {
  cfg?: Config;
  engineSeed?: number;
  days?: number; // stop after this many days (default: all)
  acceptPlan?: boolean; // confirm the scripted plan cards on day 1 (default true)
  confirmContexts?: boolean | ((type: string) => boolean); // confirm contexts found in free text (default true)
  answerCheckins?: boolean; // default true
  answerQuestionnaires?: boolean; // default true
}

export interface ReplaySession {
  data: ReplayData;
  cfg: Config;
  opts: ReplayOptions;
  day: number; // number of processed days
  state: EngineState;
  records: DayRecord[];
  actionsByDay: Action[][];
  rules: PlanRule[];
  items: PersonalItem[];
  planActions: PlanAction[];
  contexts: ContextLabel[];
  checkins: CheckinRecord[];
  questionnaires: QuestionnaireRecord[];
  freeTexts: { checkinId: string; date: string; text: string }[];
  safetyEvents: { date: string; entry: "phq9_item9" | "keyword" }[];
}

export function scriptFor<T extends ScriptEvent["type"]>(data: ReplayData, date: string, type: T): Extract<ScriptEvent, { type: T }> | null {
  return (data.script.find((e) => e.date === date && e.type === type) as Extract<ScriptEvent, { type: T }> | undefined) ?? null;
}

/** The persona's answers to a questionnaire offered on `date`: the latest scripted event on or before it. */
export function scriptedQuestionnaire(data: ReplayData, date: string, instrument: "PHQ2" | "PHQ9"): number[] | null {
  const events = data.script.filter((e): e is Extract<ScriptEvent, { type: "questionnaire_answers" }> => e.type === "questionnaire_answers" && e.instrument === instrument);
  const past = events.filter((e) => e.date <= date).sort((a, b) => (a.date < b.date ? 1 : -1));
  return (past[0] ?? events.sort((a, b) => (a.date < b.date ? -1 : 1))[0])?.answers ?? null;
}

/** Turn the scripted plan into confirmed cards, through the real task G guardrails. */
export function scriptedPlan(data: ReplayData, state: EngineState, cfg: Config): { state: EngineState; rules: PlanRule[]; items: PersonalItem[]; actions: PlanAction[] } {
  const ev = data.script.find((e): e is Extract<ScriptEvent, { type: "plan_text" }> => e.type === "plan_text");
  if (!ev || !ev.expected) return { state, rules: [], items: [], actions: [] };
  const plan = verifyPlan(ev.expected, ev.text, { phoneEnabled: cfg.phone.enabled });
  let st = state;
  const rules: PlanRule[] = plan.rules.map((r, i) => {
    let placeId: string | null = null;
    if (r.place_label) {
      const personaLabel = ev.places?.[r.place_label] ?? r.place_label;
      const place = data.places.find((p) => p.label === personaLabel);
      if (place) {
        const picked = pickPlace(st, place.lat, place.lon, r.place_label, cfg);
        st = picked.state;
        placeId = picked.placeId;
      }
    }
    return { id: `r${i + 1}`, feature: r.feature, direction: r.direction, placeId, quote: r.quote, active: true };
  });
  const items: PersonalItem[] = plan.personal_checkin_items.map((it, i) => ({ id: `i${i + 1}`, question: it.question, quote: it.quote, active: true }));
  const actions: PlanAction[] = plan.actions.map((a, i) => ({ id: `a${i + 1}`, text: a.text, quote: a.quote, active: true }));
  return { state: st, rules, items, actions };
}

export function startReplay(data: ReplayData, opts: ReplayOptions = {}): ReplaySession {
  const cfg = opts.cfg ?? defaultConfig;
  const s: ReplaySession = {
    data,
    cfg,
    opts,
    day: 0,
    state: initialState(opts.engineSeed ?? 1),
    records: [],
    actionsByDay: [],
    rules: [],
    items: [],
    planActions: [],
    contexts: [],
    checkins: [],
    questionnaires: [],
    freeTexts: [],
    safetyEvents: [],
  };
  if (opts.acceptPlan !== false) {
    const plan = scriptedPlan(data, s.state, cfg);
    s.state = plan.state;
    s.rules = plan.rules;
    s.items = plan.items;
    s.planActions = plan.actions;
  }
  return s;
}

function runUpdate(s: ReplaySession, date: string, state: EngineState, history: DayRecord[]) {
  const from = addDays(date, -70);
  return dailyUpdate({
    date,
    raws: s.data.raws.filter((r) => r.date >= from && r.date <= date),
    history,
    state,
    rules: s.rules,
    contexts: s.contexts,
    checkins: s.checkins.filter((c) => daysBetween(c.scheduledAt.slice(0, 10), date) < 14),
    questionnaires: s.questionnaires,
    cfg: s.cfg,
  });
}

function takeQuestionnaire(s: ReplaySession, date: string, instrument: "PHQ2" | "PHQ9"): void {
  const answers = scriptedQuestionnaire(s.data, date, instrument);
  if (!answers) return;
  const result = scoreQuestionnaire(instrument, answers, phqReference(s.questionnaires, date), s.cfg);
  s.questionnaires.push({ id: `q${s.questionnaires.length + 1}`, instrument, takenAt: `${date}T10:00:00+00:00`, answers, result });
  s.state = applyQuestionnaireResult(s.state, result);
  if (result.safetyItemPositive) s.safetyEvents.push({ date, entry: "phq9_item9" });
  if (result.nextStep === "offer_phq9") takeQuestionnaire(s, date, "PHQ9");
}

/** Process the next day. Returns false when the replay has ended. */
export function stepReplay(s: ReplaySession): boolean {
  const limit = Math.min(s.opts.days ?? s.data.raws.length, s.data.raws.length);
  if (s.day >= limit) return false;
  const date = addDays(s.data.startDate, s.day);

  // First run: the onboarding PHQ-9 (baseline_phq).
  if (s.day === 0 && s.opts.answerQuestionnaires !== false && scriptFor(s.data, date, "questionnaire_answers")) {
    takeQuestionnaire(s, date, "PHQ9");
  }

  const prevState = s.state;
  let out = runUpdate(s, date, prevState, s.records);
  s.state = out.state;

  // Check-in: the scheduled one, or one the persona starts to tell the app something.
  const scheduled = out.actions.find((a): a is Extract<Action, { type: "schedule_checkin" }> => a.type === "schedule_checkin");
  const answer = scriptFor(s.data, date, "checkin_answer");
  const ignore = scriptFor(s.data, date, "ignore_checkin");
  const selfStarted = !scheduled && answer !== null && answer.expectedContext !== undefined && s.opts.answerCheckins !== false;
  if (scheduled || selfStarted) {
    const rec: CheckinRecord = {
      id: `c${s.checkins.length + 1}`,
      scheduledAt: `${date}T09:00:00+00:00`,
      answeredAt: null,
      kind: scheduled ? scheduled.kind : "fixed",
      reasons: scheduled ? scheduled.reasons : [],
      answers: {},
      personalAnswers: {},
      hasFreeText: false,
    };
    s.checkins.push(rec);
    if (answer && !ignore && s.opts.answerCheckins !== false) {
      rec.answeredAt = `${date}T09:05:00+00:00`;
      rec.answers = { ...answer.answers };
      for (const item of s.items) {
        const a = answer.personal[item.question];
        if (a) rec.personalAnswers[item.id] = a;
      }
      rec.hasFreeText = answer.freeText !== null;
      const done = onCheckinCompleted({ record: rec, freeText: answer.freeText, recentCheckins: s.checkins, questionnaires: s.questionnaires, state: s.state.state, date, cfg: s.cfg });
      if (answer.freeText !== null) s.freeTexts.push({ checkinId: rec.id, date, text: answer.freeText });
      if (done.crisis) s.safetyEvents.push({ date, entry: "keyword" });
      if (answer.freeText !== null && answer.expectedContext !== undefined) {
        const ctx = verifyContext(answer.expectedContext, answer.freeText, date, s.cfg);
        const confirm = typeof s.opts.confirmContexts === "function" ? s.opts.confirmContexts(ctx?.type ?? "") : s.opts.confirmContexts !== false;
        if (ctx && confirm) {
          s.contexts.push(contextLabelFrom(ctx, `x${s.contexts.length + 1}`));
          // The label covers today, which was scored this morning: score today again with it.
          if (ctx.start <= date && ctx.end >= date) {
            out = runUpdate(s, date, prevState, s.records);
            s.state = out.state;
          }
        }
      }
    }
  }

  s.records.push(out.record);
  s.actionsByDay.push(out.actions);
  s.day += 1;

  if (s.opts.answerQuestionnaires !== false) {
    for (const a of out.actions) {
      if (a.type === "offer_questionnaire") takeQuestionnaire(s, date, a.id);
    }
  }
  return true;
}

export function runReplay(data: ReplayData, opts: ReplayOptions = {}): ReplaySession {
  const s = startReplay(data, opts);
  while (stepReplay(s)) {
    /* run to the end */
  }
  return s;
}
