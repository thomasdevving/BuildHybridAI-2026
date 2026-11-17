import { runReplay, simulatePersona } from "../src/index";
const tally: Record<string, number> = {}; let n = 0, spikes = 0; const zs: number[] = [];
const rsum: Record<string, number> = {}; const rcnt: Record<string, number> = {};
for (let seed = 1; seed <= 15; seed++) {
  const s = runReplay(simulatePersona(seed, "stable"), { engineSeed: seed });
  for (const r of s.records.slice(40)) {
    if (r.D === null || r.mu0 === null) continue;
    n++;
    const z = (r.D - r.mu0) / (r.sigma0 as number); zs.push(z);
    for (const [k, v] of Object.entries(r.r)) if (v !== null) { const kk = k.split(":")[0]; rsum[kk] = (rsum[kk] ?? 0) + v; rcnt[kk] = (rcnt[kk] ?? 0) + 1; }
    if (z > 2) { spikes++; for (const [k, v] of Object.entries(r.r)) if (v !== null && v >= 1.5) tally[k.split(":")[0]] = (tally[k.split(":")[0]] ?? 0) + 1; }
  }
}
zs.sort((a, b) => a - b);
console.log(`days ${n}, spikes(z>2) ${spikes} = ${(100 * spikes / n).toFixed(1)}%  z quantiles 50/90/97.5/99: ${[0.5, 0.9, 0.975, 0.99].map((q) => zs[Math.floor(q * zs.length)].toFixed(2)).join(" / ")}`);
console.log("features with r>=1.5 on spike days:", Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" "));
console.log("mean r:", Object.entries(rsum).map(([k, v]) => `${k}:${(v / rcnt[k]).toFixed(2)}`).join(" "));
