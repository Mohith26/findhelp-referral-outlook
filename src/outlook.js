// Referral outlook: censoring-aware, competing-risks forecast of referral outcomes per program.
//
// Question answered for a navigator: "If I refer this person to this program today, how likely is
// a 'Got help' status within 14 days, and how soon will anyone respond?"
//
// 1. Observation as of a date: a referral either closed (Got help / closed without help) on day d,
//    or is still open and only counts for the days it has been observed (right-censored).
//    Open referrals are never counted as failures or dropped.
// 2. Category baseline: weighted discrete-time cause-specific hazards (Nelson-Aalen style), pooled
//    over every program in the category, recent referrals weighted more (half-life 365 days).
// 3. Program frailty: each program scales the baseline by theta (one per cause). With observed
//    events O and expected events E under the baseline, theta ~ Gamma(alpha + O, alpha + E):
//    the Poisson-gamma empirical-Bayes model. alpha comes from the between-program spread
//    (method of moments), so small programs are pulled toward their category.
// 4. Forecast: Aalen-Johansen cumulative incidence of "Got help" by day 14 from the program's
//    hazards; 80% interval from posterior draws of theta.

import { mulberry32, normal } from "./generate.js";

export const HORIZON = 30;
export const HALF_LIFE = 365;
export const CHANGE_THRESHOLD = 12; // ~1.4% false-flag rate per stable program (see test/outlook.test.mjs)

export function observe(referrals, asOf, { field = "outcome", halfLife = HALF_LIFE, horizon = HORIZON } = {}) {
  const out = [];
  for (const r of referrals) {
    if (r.sent >= asOf) continue;
    const follow = asOf - r.sent;
    let cause = 0;
    let t;
    if (field === "outcome") {
      if (r.outcomeDay !== null && r.outcomeDay <= follow && r.outcomeDay <= horizon) {
        cause = r.outcome === "help" ? 1 : 2;
        t = r.outcomeDay;
      } else t = Math.min(follow, horizon);
    } else {
      if (r.respDay !== null && r.respDay <= follow && r.respDay <= horizon) {
        cause = 1;
        t = r.respDay;
      } else t = Math.min(follow, horizon);
    }
    const w = halfLife ? Math.pow(0.5, (asOf - r.sent) / halfLife) : 1;
    out.push({ program: r.program, category: r.category, sent: r.sent, t, cause, w, reason: r.reason });
  }
  return out;
}

// Weighted discrete hazards per day for each cause (1..K). Returns h[k][d-1].
export function baselineHazards(obs, K, horizon = HORIZON) {
  const atRisk = new Float64Array(horizon + 2);
  const ev = Array.from({ length: K + 1 }, () => new Float64Array(horizon + 2));
  for (const o of obs) {
    // at risk on days 1..t (event on day t still counts as at risk that day)
    atRisk[1] += o.w;
    atRisk[o.t + 1] -= o.w;
    if (o.cause > 0) ev[o.cause][o.t] += o.w;
  }
  for (let d = 2; d <= horizon; d++) atRisk[d] += atRisk[d - 1];
  const h = [];
  for (let k = 1; k <= K; k++) {
    const hk = [];
    for (let d = 1; d <= horizon; d++) {
      const half = d < 8 ? 0 : d < 15 ? 1 : 3; // light smoothing where data thins out
      let e = 0;
      let r = 0;
      for (let j = Math.max(1, d - half); j <= Math.min(horizon, d + half); j++) {
        e += ev[k][j];
        r += atRisk[j];
      }
      hk.push(r > 0 ? e / r : 0);
    }
    h.push(hk);
  }
  return h;
}

function cumulative(h) {
  const c = [0];
  for (let d = 0; d < h.length; d++) c.push(c[d] + h[d]);
  return c; // c[t] = sum of h over days 1..t
}

// Method-of-moments gamma shape for theta ~ Gamma(alpha, alpha): Var(O/E) ~ 1/alpha + 1/E.
export function estimateAlpha(pairs) {
  const usable = pairs.filter((p) => p.E >= 1);
  if (usable.length < 3) return 4;
  let num = 0;
  let den = 0;
  for (const { O, E } of usable) {
    num += E * ((O / E - 1) ** 2 - 1 / E);
    den += E;
  }
  const tau2 = Math.min(4, Math.max(0.02, num / den));
  return 1 / tau2;
}

export function cifFromHazards(hs, horizon) {
  // hs: array of cause hazard arrays; returns {cif: [cause][t], open: [t]} for t = 0..horizon
  const K = hs.length;
  const cif = Array.from({ length: K }, () => [0]);
  const open = [1];
  let S = 1;
  for (let d = 1; d <= horizon; d++) {
    let tot = 0;
    const hd = hs.map((h) => h[d - 1]);
    for (const x of hd) tot += x;
    const scale = tot > 0.95 ? 0.95 / tot : 1;
    for (let k = 0; k < K; k++) cif[k].push(cif[k][d - 1] + S * hd[k] * scale);
    S *= 1 - tot * scale;
    open.push(S);
  }
  return { cif, open };
}

export function gammaSample(rng, shape, rate) {
  if (shape < 1) {
    const u = rng();
    return gammaSample(rng, shape + 1, rate) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4) return (d * v) / rate;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return (d * v) / rate;
  }
}

function quantile(sorted, q) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// Change-point check per program: did its got-help / closed-without-help rates shift at some
// point? For each candidate split (weekly, 4 to 43 weeks back) compare one rate per cause against
// separate before/after rates with a Poisson likelihood-ratio statistic (both causes, 2 df) and
// keep the largest. A program is flagged when the maximum exceeds `threshold` (calibrated on
// no-change simulations: about 1.4% of stable programs get flagged).
export function detectChange(items, asOf, { threshold = CHANGE_THRESHOLD, minExpected = 4 } = {}) {
  // items: [{sent, t, cause, E: [E_help, E_fail]}]
  let best = { stat: 0, day: null };
  for (let back = 28; back <= 300; back += 7) {
    const split = asOf - back;
    const g = [
      { O: [0, 0], E: [0, 0] },
      { O: [0, 0], E: [0, 0] },
    ];
    for (const it of items) {
      const k = it.sent < split ? 0 : 1;
      g[k].E[0] += it.E[0];
      g[k].E[1] += it.E[1];
      if (it.cause === 1) g[k].O[0]++;
      if (it.cause === 2) g[k].O[1]++;
    }
    if (g[1].E[0] + g[1].E[1] < minExpected || g[0].E[0] + g[0].E[1] < minExpected) continue;
    let stat = 0;
    for (let c = 0; c < 2; c++) {
      const O = g[0].O[c] + g[1].O[c];
      const E = g[0].E[c] + g[1].E[c];
      if (E <= 0) continue;
      const pooled = O / E;
      // 2 * (log-lik with separate rates - log-lik with the pooled rate)
      for (const gg of g) {
        if (gg.E[c] <= 0) continue;
        const sep = gg.O[c] / gg.E[c];
        stat += 2 * ((gg.O[c] > 0 ? gg.O[c] * Math.log(sep) : 0) - gg.E[c] * sep - (gg.O[c] > 0 ? gg.O[c] * Math.log(pooled || 1e-12) : 0) + gg.E[c] * pooled);
      }
    }
    if (stat > best.stat) {
      const rate = (gg, c) => (gg.E[c] > 0 ? gg.O[c] / gg.E[c] : null);
      best = { stat, day: split, before: [rate(g[0], 0), rate(g[0], 1)], after: [rate(g[1], 0), rate(g[1], 1)] };
    }
  }
  return { ...best, changed: best.stat > threshold };
}

// Fit the outlook for every program as of `asOf`.
export function fitOutlook(data, asOf, opts = {}) {
  const { forecastDay = 14, draws = 400, seed = 7, halfLife = HALF_LIFE, shrink = true, detectChanges = true } = opts;
  const rng = mulberry32(seed);
  const obsOut = observe(data.referrals, asOf, { field: "outcome", halfLife });
  const obsResp = observe(data.referrals, asOf, { field: "resp", halfLife });
  const byCat = {};
  for (const p of data.programs) (byCat[p.category] ||= []).push(p);

  const result = { asOf, forecastDay, categories: {}, programs: {} };
  const perCat = {};
  for (const [cat, progs] of Object.entries(byCat)) {
    const oCat = obsOut.filter((o) => o.category === cat);
    const rCat = obsResp.filter((o) => o.category === cat);
    const base = baselineHazards(oCat, 2); // [help, fail]
    const baseR = baselineHazards(rCat, 1); // [first update]
    const cumB = base.map(cumulative);
    const cumR = cumulative(baseR[0]);

    // Change-point check per program (unweighted, against the category baseline)
    const items = {};
    for (const o of oCat) (items[o.program] ||= []).push({ sent: o.sent, t: o.t, cause: o.cause, E: [cumB[0][o.t], cumB[1][o.t]] });
    const changes = {};
    for (const p of progs) changes[p.id] = detectChanges && p.claimed && items[p.id] ? detectChange(items[p.id], asOf) : { changed: false };
    const since = (pid) => (changes[pid].changed ? changes[pid].day : -Infinity);

    // Observed vs expected events per program and cause (only since a detected change)
    const stats = {};
    for (const p of progs) stats[p.id] = { O: [0, 0, 0], E: [0, 0, 0], E2: [0, 0, 0], n: 0, nOpen: 0, help: 0, fail: 0, reasons: {}, change: changes[p.id] };
    for (const o of oCat) {
      if (o.sent < since(o.program)) continue;
      const s = stats[o.program];
      s.O[0] += o.cause === 1 ? o.w : 0;
      s.O[1] += o.cause === 2 ? o.w : 0;
      s.E[0] += o.w * cumB[0][o.t];
      s.E[1] += o.w * cumB[1][o.t];
      s.E2[0] += o.w * o.w * cumB[0][o.t];
      s.E2[1] += o.w * o.w * cumB[1][o.t];
      if (o.cause === 2 && o.reason) s.reasons[o.reason] = (s.reasons[o.reason] || 0) + o.w;
    }
    for (const o of rCat) {
      if (o.sent < since(o.program)) continue;
      const s = stats[o.program];
      s.O[2] += o.cause === 1 ? o.w : 0;
      s.E[2] += o.w * cumR[o.t];
      s.E2[2] += o.w * o.w * cumR[o.t];
    }
    // Weighted counts are not Poisson: rescale to effective counts (Kish-style, E/E2) so the
    // gamma-Poisson update and the moment estimate of alpha see the right amount of noise.
    for (const p of progs) {
      const s = stats[p.id];
      s.Oeff = [0, 1, 2].map((k) => (s.E2[k] > 0 ? (s.O[k] * s.E[k]) / s.E2[k] : 0));
      s.Eeff = [0, 1, 2].map((k) => (s.E2[k] > 0 ? (s.E[k] * s.E[k]) / s.E2[k] : 0));
    }
    // Unweighted counts as a dashboard would show them (all history up to asOf)
    for (const r of data.referrals) {
      if (r.category !== cat || r.sent >= asOf) continue;
      const s = stats[r.program];
      s.n++;
      const closedBy = r.outcomeDay !== null && r.sent + r.outcomeDay <= asOf;
      if (!closedBy) s.nOpen++;
      else if (r.outcome === "help") s.help++;
      else s.fail++;
    }
    perCat[cat] = { progs, stats, base, baseR, n: oCat.length };
  }

  // One spread parameter per cause, pooled over every category: theta is relative to its own
  // category baseline, and a handful of programs per category is too few for a stable moment estimate.
  const allTracked = [];
  for (const c of Object.values(perCat)) for (const p of c.progs) if (p.claimed) allTracked.push(c.stats[p.id]);
  const alpha = [0, 1, 2].map((k) => estimateAlpha(allTracked.map((s) => ({ O: s.Oeff[k], E: s.Eeff[k] }))));
  result.alpha = alpha;

  for (const [cat, { progs, stats, base, baseR, n }] of Object.entries(perCat)) {
    result.categories[cat] = { base, baseR, alpha, n };
    for (const p of progs) {
      const s = stats[p.id];
      if (!p.claimed) {
        result.programs[p.id] = { tracked: false };
        continue;
      }
      const post = [0, 1, 2].map((k) =>
        shrink ? { a: alpha[k] + s.Oeff[k], b: alpha[k] + s.Eeff[k] } : { a: Math.max(s.Oeff[k], 1e-6), b: Math.max(s.Eeff[k], 1e-6) }
      );
      const mean = post.map((q) => q.a / q.b);
      const hHelp = base[0].map((x) => x * mean[0]);
      const hFail = base[1].map((x) => x * mean[1]);
      const { cif, open } = cifFromHazards([hHelp, hFail], HORIZON);
      const resp = cifFromHazards([baseR[0].map((x) => x * mean[2])], HORIZON).cif[0];
      let median = null;
      for (let d = 1; d <= HORIZON; d++) if (median === null && resp[d] >= 0.5) median = d;

      // posterior draws for the interval
      const samples = [];
      for (let i = 0; i < draws; i++) {
        const th = gammaSample(rng, post[0].a, post[0].b);
        const tf = gammaSample(rng, post[1].a, post[1].b);
        const c = cifFromHazards([base[0].map((x) => x * th), base[1].map((x) => x * tf)], forecastDay).cif[0][forecastDay];
        samples.push(c);
      }
      samples.sort((a, b) => a - b);

      const reasonTot = Object.values(s.reasons).reduce((a, b) => a + b, 0);
      const reasons = Object.entries(s.reasons)
        .map(([k, v]) => ({ reason: k, share: reasonTot ? v / reasonTot : 0 }))
        .sort((a, b) => b.share - a.share);

      result.programs[p.id] = {
        tracked: true,
        n: s.n,
        nOpen: s.nOpen,
        effective: s.Eeff[0] > 0 ? s.Oeff[0] + s.Oeff[1] : 0,
        theta: mean,
        posterior: post,
        cif: cif[0],
        cifFail: cif[1],
        open,
        p: cif[0][forecastDay],
        pFail: cif[1][forecastDay],
        lo: quantile(samples, 0.1),
        hi: quantile(samples, 0.9),
        respCurve: resp,
        respMedian: median,
        resp3: resp[3],
        closedShare: s.help + s.fail > 0 ? s.help / (s.help + s.fail) : null,
        reasons,
        lowData: s.n < 15,
        change: s.change.changed ? { day: s.change.day, before: s.change.before, after: s.change.after, stat: s.change.stat } : null,
      };
    }
  }
  return result;
}

export function pAtLeastOne(ps) {
  return 1 - ps.reduce((acc, p) => acc * (1 - p), 1);
}

// Held-out check with rolling origins: for each origin, fit using only what was observable then,
// and score referrals sent in the following `windowDays` days on whether they recorded "Got help"
// within `forecastDay` days. Compares the outlook (eb), the same model without shrinkage (raw) and
// the got-help share of closed referrals (closed), the number a status dashboard shows.
// `truth(programId, sentDay)` is optional (only a simulator knows it).
export function backtest(data, origins, { windowDays = 35, forecastDay = 14, truth = null, smallN = 60 } = {}) {
  const rows = [];
  for (const asOf of origins) {
    const eb = fitOutlook(data, asOf, { forecastDay, draws: 1 });
    const raw = fitOutlook(data, asOf, { forecastDay, draws: 1, shrink: false });
    for (const r of data.referrals) {
      if (r.sent < asOf || r.sent >= asOf + windowDays) continue;
      if (r.sent + forecastDay > data.today) continue;
      const e = eb.programs[r.program];
      if (!e || !e.tracked) continue;
      const y = r.outcome === "help" && r.outcomeDay <= forecastDay ? 1 : 0;
      rows.push({
        origin: asOf,
        program: r.program,
        y,
        eb: e.p,
        raw: raw.programs[r.program].p,
        closed: e.closedShare === null ? e.p : e.closedShare,
        small: e.n < smallN,
        truth: truth ? truth(r.program, r.sent) : null,
      });
    }
  }
  const methods = ["eb", "raw", "closed"];
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const brier = Object.fromEntries(methods.map((m) => [m, mean(rows.map((r) => (r[m] - r.y) ** 2))]));

  // Program x origin cells with >= 5 held-out referrals: |forecast - observed share|, referral-weighted
  const cells = {};
  for (const r of rows) (cells[r.origin + ":" + r.program] ||= []).push(r);
  let nTot = 0;
  const maeObserved = Object.fromEntries(methods.map((m) => [m, 0]));
  for (const rs of Object.values(cells)) {
    if (rs.length < 5) continue;
    const obs = mean(rs.map((r) => r.y));
    nTot += rs.length;
    for (const m of methods) maeObserved[m] += rs.length * Math.abs(rs[0][m] - obs);
  }
  for (const m of methods) maeObserved[m] /= nTot;

  let maeTruth = null;
  if (truth) {
    const part = (f) => Object.fromEntries(methods.map((m) => [m, mean(rows.filter(f).map((r) => Math.abs(r[m] - r.truth)))]));
    maeTruth = { all: part(() => true), small: part((r) => r.small), large: part((r) => !r.small), nSmall: rows.filter((r) => r.small).length };
  }

  const sorted = [...rows].sort((a, b) => a.eb - b.eb);
  const B = 5;
  const bins = [];
  for (let b = 0; b < B; b++) {
    const chunk = sorted.slice(Math.floor((b * sorted.length) / B), Math.floor(((b + 1) * sorted.length) / B));
    bins.push({ predicted: mean(chunk.map((r) => r.eb)), observed: mean(chunk.map((r) => r.y)), closed: mean(chunk.map((r) => r.closed)), n: chunk.length });
  }
  return { origins, windowDays, forecastDay, n: rows.length, brier, maeObserved, maeTruth, bins, overall: mean(rows.map((r) => r.y)) };
}

// Rolling origins used by the demo: six, five weeks apart, ending ten weeks before "today".
export function defaultOrigins(today) {
  return [238, 203, 168, 133, 98, 63].map((d) => today - d);
}
