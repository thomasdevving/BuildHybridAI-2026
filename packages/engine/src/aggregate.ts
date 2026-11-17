import type { Domain, WeekAggregate, WeekInput } from "./types";
import { catalogueId } from "./features/catalogue";
import { mean } from "./stats";
import { datesOfIsoWeek, dateOfTimestamp } from "./time";

const round2 = (x: number | null): number | null => (x === null ? null : Math.round(x * 100) / 100);

/**
 * The weekly aggregate (docs/07 §3): the only thing that is ever uploaded. No dates finer
 * than the week, no free text except an approved note, no locations, labels or names.
 */
export function aggregateWeek(input: WeekInput): WeekAggregate {
  const dates = datesOfIsoWeek(input.isoWeek);
  const first = dates[0];
  const last = dates[6];
  const inWeek = (d: string) => d >= first && d <= last;

  const records = input.records.filter((r) => inWeek(r.date));
  const withIndex = records.filter((r) => r.D !== null);
  const domainMeans: Partial<Record<Domain, number>> = {};
  for (const dom of ["activity", "rhythm", "sleep", "mobility", "phone"] as Domain[]) {
    const vals = records.map((r) => r.domainScores[dom]).filter((v): v is number => typeof v === "number");
    if (vals.length > 0) domainMeans[dom] = round2(mean(vals)) as number;
  }

  const contrib = new Map<string, { n: number; r: number }>();
  for (const rec of records) {
    for (const c of rec.contributors) {
      const id = catalogueId(c.feature); // place ids never leave the device
      const cur = contrib.get(id) ?? { n: 0, r: 0 };
      cur.n++;
      cur.r += c.r;
      contrib.set(id, cur);
    }
  }
  const topContributors = [...contrib.entries()]
    .sort((a, b) => b[1].n - a[1].n || b[1].r - a[1].r || (a[0] < b[0] ? -1 : 1))
    .slice(0, 3)
    .map(([id]) => id);

  const answered = input.checkins.filter((c) => c.answeredAt !== null && inWeek(dateOfTimestamp(c.scheduledAt)));
  const emaMean = (key: "mood_low" | "enjoyment" | "energy") => round2(mean(answered.map((c) => c.answers[key]).filter((v): v is number => typeof v === "number")));

  const latest = (instrument: string) =>
    input.questionnaires
      .filter((q) => q.instrument === instrument && inWeek(dateOfTimestamp(q.takenAt)))
      .sort((a, b) => (a.takenAt < b.takenAt ? 1 : -1))[0] ?? null;
  const phq2 = latest("PHQ2");
  const phq9 = latest("PHQ9");

  const contexts = [...new Set(input.contexts.filter((c) => c.confirmed && c.start <= last && c.end >= first).map((c) => c.type))].sort();

  const m = input.markers;
  const markerMeans =
    m.length === 0
      ? null
      : {
          negative_affect: round2(mean(m.map((x) => x.negative_affect))) as number,
          anhedonic_language: round2(mean(m.map((x) => x.anhedonic_language))) as number,
          social_withdrawal: round2(mean(m.map((x) => x.social_withdrawal))) as number,
          hopelessness: round2(mean(m.map((x) => x.hopelessness))) as number,
        };

  return {
    isoWeek: input.isoWeek,
    daysWithData: withIndex.length,
    indexMean: round2(mean(withIndex.map((r) => r.D as number))),
    daysElevated: records.filter((r) => r.elevated).length,
    domainMeans,
    topContributors,
    ema: { n: answered.length, mood_low: emaMean("mood_low"), enjoyment: emaMean("enjoyment"), energy: emaMean("energy") },
    phq2: phq2 ? phq2.result.total : null,
    phq9: phq9 ? phq9.result.total : null,
    phq9Flagged: phq9 ? phq9.result.flagged : null,
    contexts,
    markerMeans,
    note: input.note ? { themes: [...input.note.themes], text: input.note.text } : null,
  };
}
