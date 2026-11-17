import { addDays, weekdayOf } from "../time";

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, couple: 2, few: 3,
};

function parseCount(tok: string): number | null {
  if (/^\d+$/.test(tok)) return Number(tok);
  return NUMBER_WORDS[tok] ?? null;
}

function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const s = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return addDays(s, 0) === s ? s : null;
}

/** Most recent date on or before `today` (start) or first on or after `today` (end) among candidates. */
function pick(cands: (string | null)[], today: string, role: "start" | "end"): string | null {
  const list = cands.filter((c): c is string => c !== null).sort();
  if (role === "start") {
    const past = list.filter((c) => c <= today);
    return past.length ? past[past.length - 1] : (list[0] ?? null);
  }
  const future = list.filter((c) => c >= today);
  return future.length ? future[0] : (list[list.length - 1] ?? null);
}

/**
 * Resolve a verbatim time phrase such as "since Tuesday" or "back on Sunday" to a date.
 * `role` says whether the phrase describes the start or the end of a period. Returns null
 * for "unknown" and for anything not understood. The model never does this (docs/05 task H).
 */
export function resolveDateHint(hint: string, today: string, role: "start" | "end"): string | null {
  if (typeof hint !== "string") return null;
  const h = hint.normalize("NFKC").toLowerCase().replace(/[^a-z0-9\-]+/g, " ").trim();
  if (h === "" || h === "unknown") return null;
  const toks = h.split(" ");
  const has = (w: string) => toks.includes(w);

  const iso = h.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  if (h.includes("day before yesterday")) return addDays(today, -2);
  if (h.includes("day after tomorrow")) return addDays(today, 2);
  if (has("yesterday")) return addDays(today, -1);
  if (has("tomorrow")) return addDays(today, 1);
  if (has("today") || has("tonight") || has("now") || h.includes("this morning") || h.includes("this afternoon") || h.includes("this evening")) return today;

  const mondayThisWeek = addDays(today, -((weekdayOf(today) + 6) % 7));

  // "3 days ago", "two weeks ago", "in 3 days", "for a week", "for the past five days"
  for (let i = 0; i < toks.length - 1; i++) {
    const n = parseCount(toks[i]);
    const unitTok = toks[i + 1] === "of" && i + 2 < toks.length ? toks[i + 2] : toks[i + 1];
    const unit = /^days?$/.test(unitTok) ? 1 : /^weeks?$/.test(unitTok) ? 7 : /^nights?$/.test(unitTok) ? 1 : 0;
    if (n === null || unit === 0) continue;
    const span = n * unit;
    if (has("ago")) return addDays(today, -span);
    if (has("past") || has("last") || has("since")) return role === "start" ? addDays(today, -span) : today;
    if (has("in") || has("another") || has("more")) return addDays(today, span);
    if (has("for") || has("next")) return role === "end" ? addDays(today, span - 1) : today;
    return role === "start" ? addDays(today, -span) : addDays(today, span - 1);
  }

  if (h.includes("weekend")) {
    const wd = weekdayOf(today);
    const saturday = wd === 0 ? addDays(today, -1) : addDays(today, 6 - wd);
    const shift = has("last") ? -7 : has("next") && wd !== 6 && wd !== 0 ? 0 : 0;
    return role === "start" ? addDays(saturday, shift) : addDays(saturday, shift + 1);
  }
  if (h.includes("last week")) return role === "start" ? addDays(mondayThisWeek, -7) : addDays(mondayThisWeek, -1);
  if (h.includes("next week")) return role === "start" ? addDays(mondayThisWeek, 7) : addDays(mondayThisWeek, 13);
  if (h.includes("this week") || h.includes("end of the week") || h.includes("rest of the week") || h.includes("all week")) {
    return role === "start" ? mondayThisWeek : addDays(mondayThisWeek, 6);
  }
  if (h.includes("end of the month") || h.includes("this month")) {
    if (role === "start") return `${today.slice(0, 8)}01`;
    let d = today;
    while (addDays(d, 1).slice(0, 7) === today.slice(0, 7)) d = addDays(d, 1);
    return d;
  }

  // Weekday names.
  for (const tok of toks) {
    const wd = WEEKDAYS[tok];
    if (wd === undefined) continue;
    const cur = weekdayOf(today);
    if (role === "start") {
      let back = (cur - wd + 7) % 7;
      if (has("last") && back === 0) back = 7;
      if (has("next") || has("coming")) return addDays(today, ((wd - cur + 7) % 7) || 7);
      return addDays(today, -back);
    }
    let fwd = (wd - cur + 7) % 7;
    if (has("next") && fwd === 0) fwd = 7;
    if (has("last")) return addDays(today, -(((cur - wd + 7) % 7) || 7));
    return addDays(today, fwd);
  }

  // "March 3", "3 March", "3rd of March".
  for (let i = 0; i < toks.length; i++) {
    const month = MONTHS[toks[i]];
    if (month === undefined) continue;
    const dayTok = [toks[i + 1], toks[i - 1], toks[i - 2]].find((t) => t !== undefined && /^\d{1,2}(st|nd|rd|th)?$/.test(t));
    if (!dayTok) continue;
    const day = parseInt(dayTok, 10);
    const y = Number(today.slice(0, 4));
    return pick([validDate(y - 1, month, day), validDate(y, month, day), validDate(y + 1, month, day)], today, role);
  }

  // "the 20th".
  const ord = h.match(/\b(\d{1,2})(st|nd|rd|th)\b/);
  if (ord) {
    const day = Number(ord[1]);
    const y = Number(today.slice(0, 4));
    const m = Number(today.slice(5, 7));
    const prev = m === 1 ? validDate(y - 1, 12, day) : validDate(y, m - 1, day);
    const next = m === 12 ? validDate(y + 1, 1, day) : validDate(y, m + 1, day);
    return pick([prev, validDate(y, m, day), next], today, role);
  }
  return null;
}

