import type { DayRaw, PersonaPlace, PersonalAnswer, ReplayData, Scenario, ScriptEvent, Visit } from "../types";
import { gaussian, mulberry32 } from "../stats";
import { addDays, dayIndex, isoFromLocalMinutes, weekdayOf } from "../time";

// docs/08 §2: persona "Sam". Pure and seeded. Only sensor data is simulated.

export const REPLAY_START_DATE = "2026-06-18"; // a Thursday, so that day 61 is a Monday
const OFFSET = "+02:00";

export const PLAN_TEXT =
  "When things go wrong I keep going to bed later, I skip the gym, I stay inside more and I eat badly. I also stop replying to messages. Calling my sister helps, and so does a walk in the morning.";

/** A correct task G output for PLAN_TEXT (the example of docs/05 §4 G). */
export const PLAN_EXPECTED = {
  rules: [
    { feature: "rest_midpoint", direction: "later", place_label: "", quote: "going to bed later" },
    { feature: "place_visits", direction: "lower", place_label: "gym", quote: "I skip the gym" },
    { feature: "home_stay", direction: "higher", place_label: "", quote: "I stay inside more" },
    { feature: "communication_time", direction: "lower", place_label: "", quote: "stop replying to messages" },
  ],
  personal_checkin_items: [
    { question: "Did you eat well today?", quote: "I eat badly" },
    { question: "Did you reply to messages today?", quote: "stop replying to messages" },
  ],
  actions: [
    { text: "Call my sister", quote: "Calling my sister helps" },
    { text: "A walk in the morning", quote: "a walk in the morning" },
  ],
};

export const HOLIDAY_TEXT = "I'm in Spain this week, back on Sunday.";
export const EXAM_TEXT = "Exam week, lots of stress.";

const P = {
  home: { label: "home", lat: 52.0907, lon: 5.1214 },
  work: { label: "work", lat: 52.0842, lon: 5.1731 },
  gym: { label: "gym", lat: 52.0975, lon: 5.1102 },
  shop: { label: "shop", lat: 52.0931, lon: 5.1267 },
  friends: { label: "friends", lat: 52.1166, lon: 5.0904 },
  park: { label: "park", lat: 52.0828, lon: 5.1349 },
  hotel: { label: "hotel", lat: 39.4702, lon: -0.3768 },
} satisfies Record<string, PersonaPlace>;
type PlaceKey = keyof typeof P;

export const PERSONA_PLACES: PersonaPlace[] = [P.home, P.work, P.gym, P.shop, P.friends, P.park];

interface Seg {
  place: PlaceKey;
  start: number; // absolute local minutes
  end: number;
  weight: number; // relative step intensity while there
}

export interface ScenarioShape {
  days: number;
  declineStart: number | null; // first day of the decline
  declineDays: number;
  holiday: [number, number] | null;
  exams: [number, number] | null;
}

export function scenarioShape(scenario: Scenario): ScenarioShape {
  switch (scenario) {
    case "slow":
      return { days: 182, declineStart: 103, declineDays: 60, holiday: [61, 67], exams: [96, 102] };
    case "stable":
      return { days: 150, declineStart: null, declineDays: 0, holiday: null, exams: null };
    default:
      return { days: 150, declineStart: 103, declineDays: 28, holiday: [61, 67], exams: [96, 102] };
  }
}

/** Decline fraction 0..1 on a 1-based day; after the decline, a partial recovery to 0.5 over 20 days. */
export function declineFraction(shape: ScenarioShape, day: number): number {
  if (shape.declineStart === null || day < shape.declineStart) return 0;
  const k = day - shape.declineStart + 1;
  if (k <= shape.declineDays) return k / shape.declineDays;
  const after = k - shape.declineDays;
  return Math.max(0.5, 1 - (0.5 * after) / 20);
}

function gymVisitsAllowed(fEndOfWeek: number): number {
  return Math.max(0, 3 - Math.floor(3 * fEndOfWeek + 1e-9));
}

export function simulatePersona(seed: number, scenario: Scenario = "default"): ReplayData {
  const rand = mulberry32((seed >>> 0) * 7919 + 104729);
  const gauss = () => gaussian(rand);
  const shape = scenarioShape(scenario);
  const n = shape.days;
  const startIdx = dayIndex(REPLAY_START_DATE);
  const dateOf = (day: number) => addDays(REPLAY_START_DATE, day - 1);
  const midnight = (day: number) => (startIdx + day - 1) * 1440;
  const isWeekend = (day: number) => {
    const w = weekdayOf(dateOf(day));
    return w === 0 || w === 6;
  };
  const inRange = (day: number, r: [number, number] | null) => r !== null && day >= r[0] && day <= r[1];
  const f = (day: number) => declineFraction(shape, day);

  // ---- rest: night ending on `day` (relative to that day's midnight) ----
  const bed: number[] = [];
  const wake: number[] = [];
  for (let day = 0; day <= n + 1; day++) {
    const we = isWeekend(day);
    let b = (we ? 15 : -45) + 25 * gauss();
    let w = (we ? 525 : 420) + 25 * gauss();
    const shift = 100 * f(day);
    b += shift;
    w += shift;
    if (inRange(day, shape.holiday) && day !== shape.holiday![0]) {
      b += 20;
      w += 20;
    }
    if (inRange(day, shape.exams)) b += 20;
    if (w - b < 300) w = b + 300;
    bed.push(b);
    wake.push(w);
  }

  // ---- day plans: time away from home ----
  const jitter = (sd: number) => sd * gauss();
  const segsByDay: Seg[][] = [];
  for (let day = 1; day <= n; day++) {
    const m0 = midnight(day);
    const wd = weekdayOf(dateOf(day));
    const fr = f(day);
    const segs: Seg[] = [];
    const add = (place: PlaceKey, from: number, to: number, weight: number) => {
      if (to - from >= 10) segs.push({ place, start: m0 + from, end: m0 + to, weight });
    };
    const hol = shape.holiday;
    if (hol && day >= hol[0] && day <= hol[1]) {
      // A resort holiday: the beach and the restaurant are next to the hotel, so the
      // phone sees one place all day.
      if (day === hol[0]) add("hotel", 840 + jitter(10), 1440, 4);
      else if (day === hol[1]) add("hotel", 0, 690 + jitter(8), 4);
      else add("hotel", 0, 1440, 4);
    } else if (wd >= 1 && wd <= 5) {
      const workIn = 530 + 150 * fr + jitter(7);
      const workOut = 1050 - 170 * fr + jitter(9);
      add("work", workIn, workOut, 2);
      const weekEnd = Math.min(n, day + (5 - wd));
      const allowed = gymVisitsAllowed(f(weekEnd + 2));
      const slot = wd === 1 ? 0 : wd === 3 ? 1 : wd === 5 ? 2 : -1; // Mon, Wed, Fri
      // When Sam goes less often, the visits early in the week are the first to go.
      if (slot >= 0 && slot >= 3 - allowed) {
        add("gym", 1070 + jitter(6), 1145 + jitter(6), 13);
      } else if ((wd === 2 || wd === 4) && fr < 0.6) {
        add("shop", workOut + 18, workOut + 48 + jitter(4), 5);
      }
    } else if (wd === 6) {
      if (fr < 0.75) add("shop", 630 + jitter(10), 675 + jitter(6), 5);
      if (fr < 0.46) add("friends", 840 + jitter(12), 1080 + jitter(15), 2.5);
    } else {
      if (fr < 0.6) add("park", 660 + jitter(12), 750 + jitter(10), 9);
    }
    segs.sort((a, b) => a.start - b.start);
    segsByDay.push(segs);
  }

  // ---- visits: away segments plus home in between (15 minutes of travel on each side) ----
  const TRAVEL = 15;
  const allVisits: { place: PlaceKey; start: number; end: number }[] = [];
  let homeFrom: number | null = midnight(1) - 600; // at home since the evening before day 1
  for (let day = 1; day <= n; day++) {
    const hol = shape.holiday;
    const onHoliday = hol !== null && day >= hol[0] && day <= hol[1];
    for (const s of segsByDay[day - 1]) {
      if (homeFrom !== null) {
        // Leaving home. On the first holiday day the journey takes most of the day.
        const leave = onHoliday ? midnight(day) + 450 : s.start - TRAVEL;
        if (leave > homeFrom) allVisits.push({ place: "home", start: homeFrom, end: leave });
        homeFrom = null;
      }
      allVisits.push({ place: s.place, start: s.start, end: s.end });
      const lastOfDay = s === segsByDay[day - 1][segsByDay[day - 1].length - 1];
      if (!onHoliday) homeFrom = s.end + TRAVEL;
      else if (lastOfDay && day === hol![1]) homeFrom = midnight(day) + 1110; // flight home, back at 18:30
    }
  }
  if (homeFrom !== null) allVisits.push({ place: "home", start: homeFrom, end: midnight(n + 1) + 480 });
  // Merge touching visits at the same place (hotel evening + hotel morning).
  const merged: typeof allVisits = [];
  for (const v of allVisits.sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && last.place === v.place && v.start - last.end <= 1) last.end = Math.max(last.end, v.end);
    else merged.push({ ...v });
  }
  const visitRecords: { start: number; end: number; visit: Visit }[] = merged.map((v) => {
    const p = P[v.place];
    return {
      start: v.start,
      end: v.end,
      visit: {
        arrive: isoFromLocalMinutes(v.start, OFFSET),
        depart: isoFromLocalMinutes(v.end, OFFSET),
        lat: p.lat + 0.00012 * gauss(),
        lon: p.lon + 0.00018 * gauss(),
      },
    };
  });

  // ---- raws ----
  const raws: DayRaw[] = [];
  for (let day = 1; day <= n; day++) {
    const m0 = midnight(day);
    const we = isWeekend(day);
    const fr = f(day);
    const restEnd = m0 + wake[day];
    const restStart = m0 + 1440 + bed[day + 1];
    const prevRestStart = m0 + bed[day];
    const weights: number[] = [];
    for (let b = 0; b < 96; b++) {
      const mid = m0 + b * 15 + 7.5;
      const asleep = (mid >= prevRestStart && mid < restEnd) || mid >= restStart;
      if (asleep) {
        weights.push(0);
        continue;
      }
      let w = 1; // at home
      let located = false;
      for (const v of merged) {
        if (mid >= v.start && mid < v.end) {
          located = true;
          if (v.place !== "home") {
            const seg = segsByDay[day - 1].find((s) => mid >= s.start && mid < s.end);
            w = seg ? seg.weight : 1.5;
          }
          break;
        }
      }
      if (!located) w = 11; // on the way
      const hourOfDay = (b * 15) / 60;
      if (w === 2 && hourOfDay >= 12.5 && hourOfDay < 13) w = 8; // lunch walk
      weights.push(w * Math.exp(0.3 * gauss()));
    }
    let target = (we ? 7000 : 8500) + 1500 * gauss();
    target *= 1 - 0.35 * fr;
    if (inRange(day, shape.holiday)) target *= 1.3;
    if (inRange(day, shape.exams)) target *= 0.92;
    target = Math.max(1500, target);
    const total = weights.reduce((a, b) => a + b, 0);
    const stepBins15 = weights.map((w) => (w === 0 ? 0 : Math.max(3, Math.round((w / total) * target))));

    const dayStart = m0;
    const dayEnd = m0 + 1440;
    const visits = visitRecords.filter((v) => v.end > dayStart && v.start < dayEnd).map((v) => v.visit);
    raws.push({
      date: dateOf(day),
      stepBins15,
      walkingSpeed: Math.round(((we ? 1.3 : 1.32) + 0.04 * gauss() - 0.08 * fr) * 1000) / 1000,
      sleep: null, // no watch: rest comes from the step-based window
      visits,
      phone: null,
    });
  }

  // ---- script: what Sam "does" in the app ----
  const srand = mulberry32((seed >>> 0) * 31337 + 7);
  const sg = () => gaussian(srand);
  const clamp7 = (x: number) => Math.max(1, Math.min(7, Math.round(x)));
  const script: ScriptEvent[] = [];
  script.push({ date: dateOf(1), type: "plan_text", text: PLAN_TEXT, expected: PLAN_EXPECTED, places: { gym: "gym" } });
  script.push({ date: dateOf(1), type: "questionnaire_answers", instrument: "PHQ9", answers: [0, 1, 0, 1, 0, 0, 0, 0, 0] });
  script.push({ date: dateOf(1), type: "questionnaire_answers", instrument: "PHQ2", answers: [0, 0] });
  for (let day = 1; day <= n; day++) {
    const fr = f(day);
    const exam = inRange(day, shape.exams);
    const hol = inRange(day, shape.holiday);
    const u = srand();
    const special = (hol && day === shape.holiday![0]) || (exam && day === shape.exams![0]);
    if (!special && fr === 0 && u < 0.06) {
      script.push({ date: dateOf(day), type: "ignore_checkin" });
      continue;
    }
    const wd = weekdayOf(dateOf(day));
    const eat: PersonalAnswer = fr > 0.55 ? "no" : fr > 0.25 ? "partly" : "yes";
    const reply: PersonalAnswer = fr > 0.7 ? "no" : fr > 0.35 ? "partly" : "yes";
    let freeText: string | null = null;
    let expectedContext: unknown;
    if (hol && day === shape.holiday![0]) {
      freeText = HOLIDAY_TEXT;
      expectedContext = { context: "holiday", start_hint: "this week", end_hint: "back on Sunday", confidence: "high", quote: "I'm in Spain this week, back on Sunday" };
    } else if (exam && day === shape.exams![0]) {
      freeText = EXAM_TEXT;
      expectedContext = { context: "exams", start_hint: "unknown", end_hint: "unknown", confidence: "high", quote: "Exam week, lots of stress" };
    } else if (fr >= 0.6 && day % 4 === 0) {
      freeText = "I have not really felt like doing anything this week. Everything takes me so much effort and I just want to stay in my room all day.";
    }
    script.push({
      date: dateOf(day),
      type: "checkin_answer",
      answers: {
        mood_low: clamp7(2 + 3 * fr + (exam ? 1 : 0) + 0.6 * sg()),
        enjoyment: clamp7(5 - 2.5 * fr + (hol ? 1 : 0) + 0.6 * sg()),
        energy: clamp7(5 - 3 * fr - (exam ? 1 : 0) + 0.6 * sg()),
        company: fr > 0.5 ? "Alone" : wd === 6 ? "Friends" : wd >= 1 && wd <= 5 ? "Colleagues or classmates" : "Alone",
      },
      personal: { "Did you eat well today?": eat, "Did you reply to messages today?": reply },
      freeText,
      ...(expectedContext ? { expectedContext } : {}),
    });
  }
  if (shape.declineStart !== null) {
    const d0 = shape.declineStart;
    const end = d0 + shape.declineDays; // first day after the decline
    script.push({ date: dateOf(d0), type: "questionnaire_answers", instrument: "PHQ2", answers: [2, 2] });
    script.push({
      date: dateOf(d0),
      type: "questionnaire_answers",
      instrument: "PHQ9",
      answers: scenario === "safety" ? [2, 2, 2, 2, 1, 1, 1, 1, 1] : [2, 2, 2, 2, 1, 1, 2, 1, 0],
    });
    if (end + 14 <= n) {
      script.push({ date: dateOf(end + 9), type: "questionnaire_answers", instrument: "PHQ2", answers: [1, 1] });
      script.push({ date: dateOf(end + 14), type: "questionnaire_answers", instrument: "PHQ9", answers: [1, 1, 1, 1, 1, 1, 0, 0, 0] });
    }
  }

  const phases: ReplayData["phases"] = [];
  if (shape.holiday) phases.push({ name: "holiday", fromDay: shape.holiday[0], toDay: shape.holiday[1] });
  if (shape.exams) phases.push({ name: "exams", fromDay: shape.exams[0], toDay: shape.exams[1] });
  if (shape.declineStart !== null) {
    phases.push({ name: "decline", fromDay: shape.declineStart, toDay: shape.declineStart + shape.declineDays - 1 });
    phases.push({ name: "after", fromDay: shape.declineStart + shape.declineDays, toDay: n });
  }
  return { startDate: REPLAY_START_DATE, raws, script, places: PERSONA_PLACES, phases };
}
