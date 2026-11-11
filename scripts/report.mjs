// Prints every number the demo page shows. Run: node scripts/report.mjs
import { generate, trueCif, dayToDate } from "../src/generate.js";
import { fitOutlook, backtest, defaultOrigins, pAtLeastOne } from "../src/outlook.js";
const t0 = Date.now();
const data = generate();
const byId = Object.fromEntries(data.programs.map((p) => [p.id, p]));
console.log("programs", data.programs.length, "referrals", data.referrals.length, "today", dayToDate(data.today).toISOString().slice(0, 10));
const fit = fitOutlook(data, data.today);
console.log("alpha (help, closed without help, first update)", fit.alpha.map((a) => a.toFixed(2)).join(", "));
const pct = (x) => (x === null || x === undefined ? "  - " : (100 * x).toFixed(0).padStart(3) + "%");
for (const p of data.programs.filter((p) => p.category === "food pantry")) {
  const o = fit.programs[p.id];
  if (!o.tracked) { console.log(p.name.padEnd(40), "untracked"); continue; }
  console.log(p.name.padEnd(40), "n", String(o.n).padStart(4), "open", String(o.nOpen).padStart(3), "p14", pct(o.p), "[", pct(o.lo), pct(o.hi), "] truth", pct(trueCif(p, data.today)), "closed-share", pct(o.closedShare), "first update median", o.respMedian, o.change ? "CHANGE since " + dayToDate(o.change.day).toISOString().slice(0, 10) : "");
}
const bt = backtest(data, defaultOrigins(data.today), { truth: (pid, day) => trueCif(byId[pid], day) });
console.log("backtest", JSON.stringify(bt, (k, v) => (typeof v === "number" ? +v.toFixed(4) : v), 1));
console.log("ms", Date.now() - t0);
