import { runReplay, simulatePersona, type Scenario } from "../src/index";
// Summary over seeds: false alarms on stable data and acceptance points on a scenario.
const seeds = Number(process.argv[2] ?? 20);
let elevDays = 0, total = 0, episodes = 0, sig: number[] = [];
for (let seed = 1; seed <= seeds; seed++) {
  const s = runReplay(simulatePersona(seed, "stable"), { engineSeed: seed });
  let prev = false;
  for (const r of s.records) {
    total++;
    const e = r.state === "ELEVATED";
    if (e) elevDays++;
    if (e && !prev) episodes++;
    prev = e;
  }
  sig.push(s.records[100].sigma0 as number);
}
console.log(`stable: ELEVATED days per 100 = ${((100 * elevDays) / total).toFixed(2)}, episodes per seed = ${(episodes / seeds).toFixed(2)}, sigma0@100 mean=${(sig.reduce((a, b) => a + b, 0) / sig.length).toFixed(3)}`);
for (const scenario of ["default", "slow"] as Scenario[]) {
  let ok = 0; const firsts: number[] = []; const fails: string[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const data = simulatePersona(seed, scenario);
    const s = runReplay(data, { engineSeed: seed });
    const u = runReplay(data, { engineSeed: seed, confirmContexts: (t) => t !== "holiday", days: 70 });
    const st = (i: number) => s.records[i - 1].state;
    const monitor = s.records.slice(14, 60).every((r) => r.state !== "WARM_UP");
    const holOk = [61, 62, 63, 64, 65, 66, 67].every((d) => st(d) !== "ELEVATED");
    const holUn = [61, 62, 63, 64, 65, 66, 67].some((d) => u.records[d - 1].state === "ELEVATED");
    const first = s.records.findIndex((r) => r.state === "ELEVATED") + 1;
    const firstAfter = s.records.findIndex((r, i) => i >= 102 && r.state === "ELEVATED") + 1;
    const c = first ? s.records[first - 1].contributors.map((x) => x.feature) : [];
    const contribOk = c.includes("rest_midpoint") && c.some((x) => x.startsWith("place_visits:"));
    const phq = s.actionsByDay.findIndex((a, i) => i + 1 >= first && a.some((x) => x.type === "offer_questionnaire" && x.id === "PHQ2")) + 1;
    const phqOk = first > 0 && phq > 0 && phq - first <= 7;
    const exam = s.records.slice(95, 102).every((r) => r.maskedDomains.length === 0);
    const all = monitor && holOk && holUn && first >= 108 && first <= 120 && contribOk && phqOk && exam;
    if (all) ok++; else fails.push(`${seed}:${monitor ? "" : "M"}${holOk ? "" : "H"}${holUn ? "" : "U"}${first >= 108 && first <= 120 ? "" : "F" + first}${contribOk ? "" : "C"}${phqOk ? "" : "P"}`);
    firsts.push(firstAfter - 102);
  }
  firsts.sort((a, b) => a - b);
  console.log(`${scenario}: all points hold for ${ok}/${seeds}; detection delay median=${firsts[Math.floor(firsts.length / 2)]} range=${firsts[0]}..${firsts[firsts.length - 1]}; fails ${fails.join(" ")}`);
}
