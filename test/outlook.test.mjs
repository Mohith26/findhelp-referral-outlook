import test from "node:test";
import assert from "node:assert/strict";
import { generate, trueCif, mulberry32, CATEGORIES } from "../src/generate.js";
import {
  observe,
  baselineHazards,
  cifFromHazards,
  gammaSample,
  estimateAlpha,
  fitOutlook,
  detectChange,
  backtest,
  defaultOrigins,
  pAtLeastOne,
} from "../src/outlook.js";

const data = generate();
const byId = Object.fromEntries(data.programs.map((p) => [p.id, p]));

test("generator is deterministic for a seed", () => {
  const again = generate();
  assert.equal(again.referrals.length, data.referrals.length);
  assert.deepEqual(again.referrals.slice(0, 50), data.referrals.slice(0, 50));
  assert.notEqual(generate(1).referrals.length, data.referrals.length);
});

test("cumulative incidence: one cause with constant hazard is geometric; causes + open sum to 1", () => {
  const h = 0.1;
  const { cif, open } = cifFromHazards([Array(30).fill(h)], 30);
  for (const t of [1, 5, 14, 30]) assert.ok(Math.abs(cif[0][t] - (1 - (1 - h) ** t)) < 1e-12);
  const two = cifFromHazards([Array(30).fill(0.07), Array(30).fill(0.03)], 30);
  for (const t of [3, 14, 30]) assert.ok(Math.abs(two.cif[0][t] + two.cif[1][t] + two.open[t] - 1) < 1e-12);
  assert.ok(Math.abs(two.cif[0][30] / two.cif[1][30] - 7 / 3) < 1e-9);
});

test("baseline hazards are unbiased under heavy censoring (open referrals are not failures)", () => {
  const rng = mulberry32(3);
  const refs = [];
  const asOf = 200;
  for (let i = 0; i < 20000; i++) {
    const sent = Math.floor(rng() * 200); // many referrals are recent and still open
    let outcome = null;
    let outcomeDay = null;
    for (let d = 1; d <= 60; d++) {
      const u = rng();
      if (u < 0.06) { outcome = "help"; outcomeDay = d; break; }
      if (u < 0.08) { outcome = "fail"; outcomeDay = d; break; }
    }
    refs.push({ program: "x", category: "c", sent, outcome, outcomeDay, respDay: outcomeDay, reason: null });
  }
  const obs = observe(refs, asOf, { halfLife: null });
  const [hHelp, hFail] = baselineHazards(obs, 2);
  const avg = (a) => a.slice(0, 14).reduce((s, x) => s + x, 0) / 14;
  assert.ok(Math.abs(avg(hHelp) - 0.06) < 0.004, "help hazard " + avg(hHelp));
  assert.ok(Math.abs(avg(hFail) - 0.02) < 0.003, "fail hazard " + avg(hFail));
  // the naive share closed with help among closed referrals answers a different question (75%)
  const closed = refs.filter((r) => r.outcomeDay !== null && r.sent + r.outcomeDay <= asOf);
  const share = closed.filter((r) => r.outcome === "help").length / closed.length;
  assert.ok(Math.abs(share - 0.75) < 0.02);
  const cif14 = cifFromHazards([hHelp, hFail], 30).cif[0][14];
  const exact = cifFromHazards([Array(30).fill(0.06), Array(30).fill(0.02)], 30).cif[0][14];
  assert.ok(Math.abs(cif14 - exact) < 0.02, `cif14 ${cif14} vs ${exact}`);
});

test("gamma sampler has the right mean and variance", () => {
  const rng = mulberry32(11);
  for (const [a, b] of [[0.6, 2], [3, 1.5], [40, 20]]) {
    const xs = Array.from({ length: 40000 }, () => gammaSample(rng, a, b));
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
    assert.ok(Math.abs(m - a / b) / (a / b) < 0.03, `mean ${m}`);
    assert.ok(Math.abs(v - a / b ** 2) / (a / b ** 2) < 0.08, `var ${v}`);
  }
});

test("method-of-moments alpha recovers the between-program spread", () => {
  const rng = mulberry32(5);
  const alphaTrue = 5;
  const pairs = [];
  for (let i = 0; i < 3000; i++) {
    const theta = gammaSample(rng, alphaTrue, alphaTrue);
    const E = 5 + rng() * 60;
    // Poisson draw by inversion
    let k = 0;
    let p = Math.exp(-theta * E);
    let c = p;
    const u = rng();
    while (u > c && k < 1000) { k++; p *= (theta * E) / k; c += p; }
    pairs.push({ O: k, E });
  }
  const a = estimateAlpha(pairs);
  assert.ok(a > 4 && a < 6.3, "alpha " + a);
});

test("small programs are shrunk toward their category; big ones barely move", () => {
  const eb = fitOutlook(data, data.today, { draws: 1 });
  const raw = fitOutlook(data, data.today, { draws: 1, shrink: false });
  const small = data.programs.find((p) => p.name === "Emergency Food Boxes");
  const big = data.programs.find((p) => p.name === "Weekly Grocery Pantry");
  const moveSmall = Math.abs(Math.log(eb.programs[small.id].theta[0] / raw.programs[small.id].theta[0]));
  const moveBig = Math.abs(Math.log(eb.programs[big.id].theta[0] / raw.programs[big.id].theta[0]));
  assert.ok(moveSmall > 3 * moveBig, `${moveSmall} vs ${moveBig}`);
  // intervals are wider for the small program
  const w = (o) => o.hi - o.lo;
  const full = fitOutlook(data, data.today);
  assert.ok(w(full.programs[small.id]) > 2 * w(full.programs[big.id]));
  // unclaimed programs get no forecast
  const unclaimed = data.programs.find((p) => !p.claimed);
  assert.equal(full.programs[unclaimed.id].tracked, false);
});

test("change check: stable programs rarely flagged, the capacity drop is caught near its true date", () => {
  let flagged = 0;
  let total = 0;
  for (let s = 1; s <= 6; s++) {
    const d = generate(500 + s);
    const fit = fitOutlook(d, d.today, { draws: 1 });
    for (const p of d.programs) {
      if (!p.claimed || p.truth.change || !fit.programs[p.id].n) continue;
      total++;
      if (fit.programs[p.id].change) flagged++;
    }
  }
  assert.ok(flagged / total < 0.03, `false flags ${flagged}/${total}`);
  const fit = fitOutlook(data, data.today, { draws: 1 });
  const cc = data.programs.find((p) => p.name === "Client-Choice Pantry");
  const ch = fit.programs[cc.id].change;
  assert.ok(ch, "capacity drop detected");
  assert.ok(Math.abs(ch.day - cc.truth.change.day) <= 21, `detected ${ch.day} vs true ${cc.truth.change.day}`);
  assert.ok(ch.after[0] < ch.before[0] && ch.after[1] > ch.before[1]);
  // and with the change handled, today's forecast tracks the post-change truth
  assert.ok(Math.abs(fit.programs[cc.id].p - trueCif(cc, data.today)) < 0.06);
});

test("detectChange on a flat synthetic program stays below threshold", () => {
  const items = [];
  for (let i = 0; i < 300; i++) items.push({ sent: i, t: 10, cause: i % 3 === 0 ? 1 : i % 7 === 0 ? 2 : 0, E: [0.33, 0.14] });
  assert.equal(detectChange(items, 300).changed, false);
});

test("backtest: forecasts are calibrated and far closer than the closed-referral share", () => {
  const bt = backtest(data, defaultOrigins(data.today), { truth: (pid, day) => trueCif(byId[pid], day) });
  assert.ok(bt.n > 1500);
  assert.ok(bt.maeTruth.all.eb < 0.05, "eb vs truth " + bt.maeTruth.all.eb);
  assert.ok(bt.maeTruth.all.closed > 0.25);
  assert.ok(bt.maeTruth.small.eb < bt.maeTruth.small.raw, "shrinkage helps small programs");
  assert.ok(bt.brier.eb < bt.brier.closed);
  for (const b of bt.bins) assert.ok(Math.abs(b.predicted - b.observed) < 0.07, JSON.stringify(b));
});

test("chance at least one of several programs helps", () => {
  assert.equal(pAtLeastOne([]), 0);
  assert.ok(Math.abs(pAtLeastOne([0.5, 0.5]) - 0.75) < 1e-12);
  assert.ok(Math.abs(pAtLeastOne([0.2, 0.3, 0.1]) - (1 - 0.8 * 0.7 * 0.9)) < 1e-12);
});

test("every category has a baseline and food pantry forecasts are sane", () => {
  const fit = fitOutlook(data, data.today, { draws: 50 });
  for (const c of Object.keys(CATEGORIES)) assert.ok(fit.categories[c].base[0].some((x) => x > 0));
  for (const p of data.programs) {
    const o = fit.programs[p.id];
    if (!o.tracked) continue;
    assert.ok(o.p >= 0 && o.p <= 1 && o.lo <= o.p + 1e-9 && o.hi >= o.p - 0.02, p.name);
    assert.ok(o.p + o.pFail <= 1 + 1e-9);
  }
});
