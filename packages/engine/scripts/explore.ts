import { runReplay, simulatePersona, type Scenario } from "../src/index";

const scenario = (process.argv[2] ?? "default") as Scenario;
const seeds = Number(process.argv[3] ?? 5);
const confirm = process.argv[4] !== "noconfirm";
const verbose = process.argv[5] === "v";
for (let seed = 1; seed <= seeds; seed++) {
  const t0 = Date.now();
  const s = runReplay(simulatePersona(seed, scenario), { engineSeed: seed, confirmContexts: confirm });
  const day = (i: number) => i + 1;
  const firstMonitor = s.records.findIndex((r) => r.state === "MONITOR");
  const elevDays = s.records.map((r, i) => (r.state === "ELEVATED" || r.elevated ? day(i) : 0)).filter(Boolean);
  const firstElev = s.records.findIndex((r) => r.state === "ELEVATED");
  const phq2 = s.actionsByDay.map((a, i) => (a.some((x) => x.type === "offer_questionnaire" && x.id === "PHQ2") ? `${day(i)}:${(a.find((x) => x.type === "offer_questionnaire") as any).reason}` : "")).filter(Boolean);
  const conf = s.records.findIndex((r) => r.state === "CONFIRMED");
  const maxPerDay = Math.max(...Object.values(s.checkins.reduce((m: any, c) => ((m[c.scheduledAt.slice(0, 10)] = (m[c.scheduledAt.slice(0, 10)] ?? 0) + 1), m), {})) as number[]);
  console.log(
    `seed ${seed}: monitor@${firstMonitor + 1} firstElev@${firstElev + 1} contrib=[${firstElev >= 0 ? s.records[firstElev].contributors.map((c) => c.feature + ":" + c.r.toFixed(1)).join(",") : ""}] elevDays=${elevDays.slice(0, 12).join(",")}${elevDays.length > 12 ? "…(" + elevDays.length + ")" : ""} phq2=${phq2.slice(0, 4).join(",")} confirmed@${conf + 1} checkins=${s.checkins.length} maxPerDay=${maxPerDay} ${Date.now() - t0}ms`,
  );
  if (verbose) {
    for (const [i, r] of s.records.entries()) {
      if (i < 14) continue;
      console.log(
        `${String(i + 1).padStart(3)} ${r.date} ${r.state.padEnd(9)} D=${r.D?.toFixed(2)} Dd=${r.D_daily?.toFixed(2)} S=${r.S.toFixed(2)} UCL=${r.UCL?.toFixed(2)} C=${r.C.toFixed(1)} mu=${r.mu0?.toFixed(2)} sg=${r.sigma0?.toFixed(2)} G=${Object.entries(r.domainScores).map(([k, v]) => k.slice(0, 3) + ":" + (v as number).toFixed(2)).join(" ")} m=[${r.maskedDomains}] ${r.contributors.map((c) => c.phrase).join("; ")}`,
      );
    }
  }
}
