import { generate, trueCif, dayToDate } from "./src/generate.js";
import { fitOutlook, backtest, defaultOrigins, pAtLeastOne, CHANGE_THRESHOLD } from "./src/outlook.js";

const data = generate();
const fit = fitOutlook(data, data.today);
const byId = Object.fromEntries(data.programs.map((p) => [p.id, p]));

const ZIP = { lat: 30.2635, lon: -97.7141 }; // 78702
const CATS = [["c", "Food"], ["f", "Housing"], ["d", "Goods"], ["i", "Transit"], ["e", "Health"], ["h", "Money"], ["a", "Care"], ["b", "Education"], ["j", "Work"], ["g", "Legal"]];
document.getElementById("cats").innerHTML = CATS.map(([k, n]) => `<li><i class="icon" data-icon="${k}"></i><span>${n}</span></li>`).join("");

const DESCRIPTIONS = {
  "Weekly Grocery Pantry": "Eastside Neighbors Alliance runs a weekly grocery pantry for individuals and families in East Austin. This program provides: shelf-stable groceries, fresh produce when available, and household items. New clients complete a short intake at their first visit.",
  "Client-Choice Pantry": "Govalle Family Resource Center offers a client-choice pantry where families shop for the groceries they need. This program provides: groceries, dairy, bread and personal care items for households in the 78721, 78702 and 78741 areas.",
  "Drive-Through Food Distribution": "Montopolis Community Pantry hosts drive-through food distributions. This program provides: a pre-packed box of groceries per household. Walk-ups are welcome at the side entrance. Bring a photo ID for each adult.",
  "Emergency Food Boxes": "St. Brigid Outreach Center provides emergency food boxes for people facing an immediate food shortage. This program provides: a 3-day supply of food. Call ahead so staff can prepare a box.",
  "Senior Grocery Program": "Riverside Senior Services provides monthly groceries for adults 60 and older. This program provides: a monthly grocery box and help applying for SNAP. Delivery is available for some homebound seniors.",
  "Mobile Food Pantry": "Hill Country Harvest Network brings a mobile pantry truck to neighborhood sites across East Austin. This program provides: fresh produce, protein and pantry staples. Check the schedule for this week's stops.",
  "Fresh Produce Market": "Rosewood Community Kitchen hosts a free produce market. This program provides: seasonal fruits and vegetables from local growers. No sign-up needed.",
  "Family Food Pantry": "Holly Street Mutual Aid runs a family pantry staffed by neighbors. This program provides: groceries, baby food and hygiene items for families with children.",
  "Campus Food Pantry": "Austin Learning Collaborative operates a food pantry for adult learners and their families. This program provides: snacks, groceries and meal kits.",
  "Weekend Meal Bags": "Dove Springs Youth Partners sends children home with weekend meal bags. This program provides: easy-to-prepare meals for school-age children over the weekend.",
  "Pantry Pickup Program": "North Lamar Community Church offers a pantry pickup on weekday mornings. This program provides: groceries and bread for anyone in need.",
  "Grocery Delivery for Homebound Adults": "Capital Area Meals Collective delivers groceries to adults who can't leave home. This program provides: a biweekly grocery delivery and a check-in call.",
  "Baby Formula and Diaper Pantry": "Little Steps Family Network provides formula and diapers for infants. This program provides: formula, diapers and wipes for families with children under 3.",
  "Veterans Food Pantry": "Lone Star Veterans Outreach operates a pantry for veterans and their households. This program provides: groceries and help connecting to VA benefits.",
  "Community Fridge Network": "Chestnut Neighborhood Project maintains community fridges stocked by neighbors. This program provides: free food available any time.",
  "Halal Food Pantry": "Riverside Muslim Community Services runs a halal food pantry open to all. This program provides: halal groceries, rice, flour and produce.",
  "South Austin Food Pantry": "South Congress Neighbors United runs a weekly pantry for South Austin residents. This program provides: groceries, fresh produce and personal care items.",
  "Pflugerville Area Pantry": "Pfluger Hills Helping Hands serves families in Pflugerville and northeast Travis County. This program provides: groceries and holiday food boxes.",
};
const SCHEDULES = [
  { open: true, hours: "9:00 AM - 5:00 PM CST" },
  { open: false },
  { open: true, hours: "8:00 AM - 6:00 PM CST" },
  { open: false },
  { open: true, hours: "10:00 AM - 2:00 PM CST" },
];
const NEXT_STEPS = [
  (p) => `Call <a href="#">${p.phone}</a>.`,
  () => `Go to the <a href="#">program's website</a>.`,
  (p) => `Call or text <a href="#">${p.phone}</a> to schedule a pickup.`,
  () => `Visit during open hours and bring a photo ID.`,
];

function miles(a, b) {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const pantries = data.programs
  .filter((p) => p.category === "food pantry")
  .map((p, i) => ({
    ...p,
    idx: i,
    dist: miles(ZIP, p),
    o: fit.programs[p.id],
    desc: DESCRIPTIONS[p.name],
    schedule: SCHEDULES[i % SCHEDULES.length],
    nextStep: NEXT_STEPS[i % NEXT_STEPS.length](p),
  }));
// Findhelp's relevance: claimed, featured, serves anyone, local (no outcome data in it today)
for (const p of pantries) p.relevance = (p.claimed ? 2 : 0) + (p.featured ? 2 : 0) + (p.servesAnyone ? 1 : 0) + (p.dist < 5 ? 1 : 0) - 0.08 * p.dist;

const state = { sort: "relevance", selected: new Set(), expanded: new Set() };
const weekly = pantries.find((p) => p.name === "Weekly Grocery Pantry");
const clientChoice = pantries.find((p) => p.name === "Client-Choice Pantry");
state.selected.add(weekly.id).add(clientChoice.id);
state.expanded.add(clientChoice.id);

const pct = (x) => Math.round(100 * x) + "%";
const fmtDate = (day) => dayToDate(day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const tone = (p) => (p >= 0.45 ? "good" : p >= 0.3 ? "mid" : "low");

function sorted() {
  const list = [...pantries];
  if (state.sort === "relevance") list.sort((a, b) => b.relevance - a.relevance);
  if (state.sort === "closest") list.sort((a, b) => a.dist - b.dist);
  if (state.sort === "outlook") list.sort((a, b) => (b.o.tracked ? b.o.p : -1) - (a.o.tracked ? a.o.p : -1));
  return list.slice(0, 10);
}

function outlookBlock(p) {
  const o = p.o;
  if (!o.tracked) {
    return `<div class="tagrow outlook"><span class="lbl"><i class="fa fa-line-chart"></i>Outlook:</span>
      <span class="ol-none">Not available. This program hasn't claimed its listing, so referral outcomes aren't tracked.</span></div>`;
  }
  let flag = "";
  if (o.change) {
    const down = o.change.after[0] < o.change.before[0];
    flag = `<div class="ol-flag"><i class="fa fa-exclamation-triangle"></i>${down ? "Fewer referrals getting help" : "More referrals getting help"} since ${fmtDate(o.change.day)}${o.reasons[0] && down ? `, most now close as "${o.reasons[0].reason}"` : ""}</div>`;
  } else if (o.nOpen / o.n > 0.6) {
    flag = `<div class="ol-flag"><i class="fa fa-clock-o"></i>Rarely updates referrals: ${o.nOpen} of ${o.n} are still open</div>`;
  } else if (o.lowData) {
    flag = `<div class="ol-flag info"><i class="fa fa-info-circle"></i>Only ${o.n} referrals so far, so this leans on similar pantries</div>`;
  }
  const resp = o.respMedian ? (o.respMedian <= 1 ? "within a day" : `in about ${o.respMedian} days`) : "after more than 30 days";
  return `<div class="tagrow outlook"><span class="lbl"><i class="fa fa-line-chart"></i>Outlook:</span>
    <div class="ol-body">
      <div class="ol-main"><span class="ol-pct ${tone(o.p)}">${pct(o.p)}</span><span class="ol-text">of referrals record <b>Got help</b> within 14 days</span>
        <span class="ol-bar" title="likely range ${pct(o.lo)}-${pct(o.hi)}"><span class="fill ${tone(o.p)}" style="width:${(100 * o.p).toFixed(1)}%"></span><span class="range" style="left:${(100 * o.lo).toFixed(1)}%;width:${(100 * (o.hi - o.lo)).toFixed(1)}%"></span></span></div>
      <div class="ol-sub">Likely ${pct(o.lo)}-${pct(o.hi)} · first status update ${resp} · <a href="#" data-more="${p.id}">Why?</a></div>
      ${flag}
    </div></div>`;
}

function chartSvg(o) {
  const W = 380, H = 168, L = 34, R = 8, T = 8, B = 26;
  const x = (d) => L + ((W - L - R) * d) / 30;
  const y = (v) => T + (H - T - B) * (1 - v);
  const help = o.cif, fail = o.cifFail;
  const area = (lower, upper, color, op) => {
    let path = `M${x(0)},${y(upper(0))}`;
    for (let d = 1; d <= 30; d++) path += ` L${x(d)},${y(upper(d))}`;
    for (let d = 30; d >= 0; d--) path += ` L${x(d)},${y(lower(d))}`;
    return `<path d="${path} Z" fill="${color}" fill-opacity="${op}"/>`;
  };
  let g = "";
  for (const v of [0, 0.25, 0.5, 0.75, 1]) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#ece9de"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#5b4447">${v * 100}%</text>`;
  for (const d of [0, 7, 14, 21, 28]) g += `<text x="${x(d)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#5b4447">${d === 0 ? "day 0" : d}</text>`;
  g += area(() => 0, (d) => help[d], "#007575", 0.85);
  g += area((d) => help[d], (d) => help[d] + fail[d], "#be3b19", 0.55);
  g += area((d) => help[d] + fail[d], () => 1, "#ece9de", 1);
  g += `<line x1="${x(14)}" x2="${x(14)}" y1="${T}" y2="${H - B}" stroke="#351417" stroke-dasharray="3 3"/>`;
  g += `<text x="${x(14) + 5}" y="${y(help[14]) + 15}" font-size="12" font-weight="700" fill="#fff">${pct(help[14])}</text>`;
  return `<svg width="${W}" height="${H}" role="img" aria-label="Outcome of a new referral by day">${g}</svg>`;
}

function morePanel(p) {
  const o = p.o;
  const rows = [
    ["Eligibility:", p.serving ? `This program serves ${p.serving.join(" and ")}.` : "This program helps anyone in need in its service area."],
    ["Availability:", "available"],
    ["Cost:", "free"],
    ["Languages:", "English, Spanish"],
  ];
  let outlookRow = "";
  if (o.tracked) {
    const reasons = o.reasons.slice(0, 3).map((r) => `<tr><td>${r.reason}</td><td class="num">${pct(r.share)}</td></tr>`).join("");
    const open14 = 1 - o.cif[14] - o.cifFail[14];
    const change = o.change
      ? `<p><b>Change detected around ${fmtDate(o.change.day)}.</b> Since then, referrals close as Got help at ${o.change.after[0].toFixed(2)}x the category baseline (was ${o.change.before[0].toFixed(2)}x) and close without help at ${o.change.after[1].toFixed(2)}x (was ${o.change.before[1].toFixed(2)}x). The outlook uses referrals since that date.</p>`
      : "";
    outlookRow = `<div class="info-row"><div class="k">Referral outlook:</div><div class="v"><div class="ol-detail">
      <div class="ol-chart">${chartSvg(o)}<div class="ol-legend"><span><i style="background:#007575"></i>Got help</span><span><i style="background:#be3b19;opacity:.6"></i>Closed without help</span><span><i style="background:#ece9de"></i>Still open</span></div></div>
      <div class="ol-facts">
        <p>For a referral sent today: <b>${pct(o.p)}</b> record Got help within 14 days (likely range ${pct(o.lo)}-${pct(o.hi)}), ${pct(o.pFail)} close without help and ${pct(open14)} are still open.</p>
        ${change}
        <p style="margin-bottom:2px">Most common reasons for closing without help:</p><table>${reasons}</table>
        <div class="cmp">The status report shows <b>${pct(o.closedShare)}</b> of closed referrals got help. That share leaves out the ${o.nOpen} of ${o.n} referrals still open, so it can't say what a new referral should expect.</div>
      </div></div></div></div>`;
  }
  return `<div class="panel-wrapper">${rows.map(([k, v]) => `<div class="info-row"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}${outlookRow}</div>`;
}

function card(p, i) {
  const sel = state.selected.has(p.id);
  const tags = p.tags.map((t) => `<a href="#">${t}</a>`).join("");
  const serving = (p.serving || ["anyone in need", "all ages", "individuals", "families"]).map((t) => `<a href="#">${t}</a>`).join("");
  const hours = p.schedule.open
    ? `<i class="fa fa-clock-o teal"></i><span class="open-now">Open Now</span> : <span class="see-hours">${p.schedule.hours}</span> <i class="fa fa-chevron-down see-hours"></i>`
    : `<i class="fa fa-clock-o open-closed"></i><span class="open-closed">Closed Now</span> : <span class="see-hours">See open hours</span> <i class="fa fa-chevron-down see-hours"></i>`;
  return `<article class="card" data-id="${p.id}">
    ${p.claimed ? '<span class="claim-badge" title="Claimed by the organization"><i class="fa fa-check"></i></span>' : ""}
    <div class="card-head">
        <div class="card-heading"><span class="chk ${sel ? "on" : ""}" data-sel="${p.id}" role="checkbox" aria-checked="${sel}">${sel ? '<i class="fa fa-check"></i>' : ""}</span><a class="result-program" href="#">${p.name}</a></div>
        <div class="result-agency">by <a href="#">${p.org}</a></div>
        <div class="reviewed"><i class="fa fa-check-circle"></i>Reviewed on: ${dayToDate(data.today - p.reviewedDaysAgo).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", timeZone: "UTC" })}</div>
        ${p.featured ? '<div class="pref-partner"><i class="fa fa-map-marker"></i> Preferred Partner <i class="fa fa-info-circle"></i></div>' : ""}
    </div>
    <div class="card-main">
      <div class="card-details">
        <div class="summary">${p.desc}</div>
        <div class="tagrow svc"><span class="lbl"><i class="fa fa-tag"></i>Main Services:</span><span>${tags}</span></div>
        <div class="tagrow"><span class="lbl"><i class="fa fa-user"></i>Serving:</span><span>${serving}</span></div>
        ${outlookBlock(p)}
      </div>
      <div class="card-next">
        <div class="next-steps"><h4>Next Steps:</h4>
          <div class="ns-item">${p.nextStep}</div>
          <div class="ns-item"><i class="fa fa-map-marker"></i>${p.dist.toFixed(2)} miles ( serves your local area)</div>
          <div class="ns-item"><a href="#">${p.address}</a></div>
          <div class="ns-item">${hours}</div>
        </div>
      </div>
    </div>
    <div class="actions">
      <button class="more-info" data-more="${p.id}">More info <i class="fa fa-chevron-${state.expanded.has(p.id) ? "up" : "down"}"></i></button>
      <div class="icon-btns">
        <button class="icon-btn"><i class="fa fa-star"></i>Save</button>
        <button class="icon-btn"><i class="fa fa-paper-plane"></i>Share</button>
        <button class="icon-btn"><i class="fa fa-list"></i>Notes</button>
        <button class="icon-btn"><i class="fa fa-pencil"></i>Suggest</button>
      </div>
      <button class="refer">${p.claimed ? '<i class="fa fa-share"></i>Refer' : '<i class="fa fa-arrow-right"></i>See next steps'}</button>
    </div>
    ${state.expanded.has(p.id) ? morePanel(p) : ""}
  </article>`;
}

// Best replacement for the weakest selected program among tracked pantries no farther than the farthest selected one (+1 mile)
function bestSwap(sel) {
  if (sel.length < 1) return null;
  const maxD = Math.max(...sel.map((p) => p.dist)) + 1;
  const weakest = [...sel].sort((a, b) => a.o.p - b.o.p)[0];
  const rest = sel.filter((p) => p !== weakest);
  const base = pAtLeastOne(sel.map((p) => p.o.p));
  let best = null;
  for (const c of pantries) {
    if (!c.o.tracked || state.selected.has(c.id) || c.dist > maxD) continue;
    const v = pAtLeastOne([...rest, c].map((p) => p.o.p));
    if (!best || v > best.v) best = { c, v, out: weakest };
  }
  return best && best.v - base >= 0.03 ? { ...best, gain: best.v - base } : null;
}

function selectionCard() {
  const sel = pantries.filter((p) => state.selected.has(p.id) && p.o.tracked);
  const el = document.getElementById("selection-card");
  if (!sel.length) {
    el.innerHTML = `<h5>Referral outlook</h5><div class="small">Check two or more programs to see the chance that at least one records Got help within 14 days.</div><a class="acc" href="#" data-acc>How accurate is this? <i class="fa fa-angle-right"></i></a>`;
    return;
  }
  const v = pAtLeastOne(sel.map((p) => p.o.p));
  const swap = bestSwap(sel);
  el.innerHTML = `<h5>Referral outlook: ${sel.length} selected</h5>
    <div class="big">${pct(v)}</div>
    <div class="small">chance at least one records <b>Got help</b> within 14 days if you refer to ${sel.length === 1 ? "this program" : "all of them"}</div>
    <ul>${sel.map((p) => `<li><span>${p.name}</span><span>${pct(p.o.p)}</span></li>`).join("")}</ul>
    ${swap ? `<div class="swap">Swap <b>${swap.out.name}</b> for <b>${swap.c.name}</b> (${swap.c.dist.toFixed(1)} mi): <b>${pct(swap.v)}</b>, up ${Math.round(100 * swap.gain)} points.<br><button data-swap="${swap.out.id}:${swap.c.id}">Swap</button></div>` : ""}
    <div class="small" style="margin-top:7px">Treats programs as independent. Unclaimed programs aren't counted.</div>
    <a class="acc" href="#" data-acc>How accurate is this? <i class="fa fa-angle-right"></i></a>`;
}

let map = null;
let markers = [];
function renderMap(list) {
  if (!window.L) return;
  if (!map) {
    map = L.map("map", { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([30.262, -97.714], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
  }
  markers.forEach((m) => m.remove());
  markers = list.map((p, i) =>
    L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "", html: `<div class="pin ${state.selected.has(p.id) ? "sel" : ""}"><b>${i + 1}</b></div>`, iconSize: [24, 24], iconAnchor: [12, 24] }) })
      .bindTooltip(p.name)
      .addTo(map)
  );
  map.fitBounds(L.latLngBounds(list.map((p) => [p.lat, p.lon])), { padding: [22, 22] });
}

function render() {
  const list = sorted();
  document.getElementById("results").innerHTML = list.map(card).join("");
  document.querySelectorAll(".sort-btn").forEach((b) => b.classList.toggle("active", b.dataset.sort === state.sort));
  selectionCard();
  renderMap(list);
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-sel],[data-more],[data-sort],[data-swap],[data-acc],#modal-close");
  if (!t) return;
  e.preventDefault();
  if (t.dataset.sel) {
    const id = t.dataset.sel;
    state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    render();
  } else if (t.dataset.more) {
    const id = t.dataset.more;
    state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
    render();
  } else if (t.dataset.sort) {
    state.sort = t.dataset.sort;
    render();
  } else if (t.dataset.swap) {
    const [out, inn] = t.dataset.swap.split(":");
    state.selected.delete(out);
    state.selected.add(inn);
    render();
  } else if (t.dataset.acc !== undefined) {
    openModal();
  } else if (t.id === "modal-close") {
    document.getElementById("modal").hidden = true;
  }
});
document.getElementById("modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") e.currentTarget.hidden = true;
});

let btCache = null;
function openModal() {
  if (!btCache) btCache = backtest(data, defaultOrigins(data.today), { truth: (pid, day) => trueCif(byId[pid], day) });
  const bt = btCache;
  const W = 300, H = 260, L = 40, B = 34, T = 10, R = 18;
  const x = (v) => L + (W - L - R) * v;
  const y = (v) => T + (H - T - B) * (1 - v);
  let g = `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="#fff" stroke="#ece9de"/>`;
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    g += `<line x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${H - B}" stroke="#f3f1ea"/><line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#f3f1ea"/>`;
    g += `<text x="${x(v)}" y="${H - B + 15}" font-size="11" text-anchor="middle" fill="#5b4447">${v * 100}%</text><text x="${L - 5}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#5b4447">${v * 100}%</text>`;
  }
  g += `<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="#351417" stroke-dasharray="4 3"/>`;
  for (const b of bt.bins) {
    g += `<circle cx="${x(b.closed)}" cy="${y(b.observed)}" r="6" fill="#be3b19" fill-opacity=".75"/>`;
    g += `<circle cx="${x(b.predicted)}" cy="${y(b.observed)}" r="6" fill="#007575"/>`;
  }
  g += `<text x="${(L + W - R) / 2}" y="${H - 3}" font-size="12" text-anchor="middle" fill="#351417">forecast</text>`;
  g += `<text transform="translate(11 ${(T + H - B) / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="#351417">actually got help in 14 days</text>`;
  const p1 = (v) => (100 * v).toFixed(1);
  const m = bt.maeTruth;
  document.getElementById("modal-body").innerHTML = `
    <div class="modal-grid">
      <div><svg width="${W}" height="${H}">${g}</svg>
        <div class="ol-legend"><span><i style="background:#007575"></i>Referral outlook</span><span><i style="background:#be3b19;opacity:.75"></i>Closed-referral share</span></div></div>
      <div>
        <p>Rolling backtest on this demo network: ${bt.origins.length} cutoffs, five weeks apart. At each cutoff the model sees only what was known then and is scored on the ${bt.n.toLocaleString()} referrals sent over the next five weeks: did each record <b>Got help</b> within 14 days?</p>
        <p>Grouped into five equal bins, the forecasts sit on the diagonal. The got-help share of closed referrals, the number status reports show today, sits far to the right because it ignores referrals that never close.</p>
      </div>
    </div>
    <table class="bt">
      <tr><th>Average error, percentage points</th><th>vs. true rate</th><th>programs with &lt;60 referrals</th><th>vs. observed share*</th><th>Brier score</th></tr>
      <tr><td><b>Referral outlook</b> (shrinkage + censoring + change check)</td><td><b>${p1(m.all.eb)}</b></td><td><b>${p1(m.small.eb)}</b></td><td>${p1(bt.maeObserved.eb)}</td><td>${bt.brier.eb.toFixed(3)}</td></tr>
      <tr><td>Same model without shrinkage</td><td>${p1(m.all.raw)}</td><td>${p1(m.small.raw)}</td><td>${p1(bt.maeObserved.raw)}</td><td>${bt.brier.raw.toFixed(3)}</td></tr>
      <tr><td>Got-help share of closed referrals</td><td>${p1(m.all.closed)}</td><td>${p1(m.small.closed)}</td><td>${p1(bt.maeObserved.closed)}</td><td>${bt.brier.closed.toFixed(3)}</td></tr>
    </table>
    <p class="note">"True rate" is the simulator's own probability for each referral, which only exists because this is synthetic data. *Observed shares come from 5 to 30 held-out referrals per program and cutoff, so even a perfect forecast shows error there. A change is flagged when the likelihood-ratio statistic passes ${CHANGE_THRESHOLD}, which flags about 1.4% of stable programs in no-change simulations.</p>`;
  document.getElementById("modal").hidden = false;
}

render();
if (location.hash === "#accuracy") openModal();
