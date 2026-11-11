// Synthetic referral network for the Referral outlook demo.
// Seeded and deterministic: same seed, same programs, same referrals.
// Programs and organizations are fictional. Nothing here describes a real CBO.

export const SEED = 20261110;
export const DAY0 = Date.UTC(2025, 4, 20); // 2025-05-20, first day of history
export const TODAY = Date.UTC(2026, 10, 10); // 2026-11-10, "today" in the demo
export const T_TODAY = Math.round((TODAY - DAY0) / 86400000); // day index of today
export const MAX_FOLLOW = 60; // a referral with no closed status after 60 days stays "Not updated" forever

export const FAIL_REASONS = [
  "No capacity",
  "Couldn't contact",
  "Not eligible",
  "Couldn't get help",
  "No longer interested",
  "Referred elsewhere",
];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normal(rng) {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function poisson(rng, lambda) {
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(rng)));
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

// True category-level daily hazards (the model never sees these; it estimates its own baseline).
export const CATEGORIES = {
  "food pantry": { help: [0.11, 6], fail: [0.03, 8], resp: [0.34, 5] },
  "rent assistance": { help: [0.034, 14], fail: [0.034, 12], resp: [0.16, 8] },
  "help pay for utilities": { help: [0.06, 9], fail: [0.03, 10], resp: [0.22, 6] },
  transportation: { help: [0.08, 7], fail: [0.025, 8], resp: [0.26, 6] },
};

export function baseHazard([A, tau], d) {
  const ramp = d === 1 ? 0.55 : 1;
  return A * ramp * Math.exp(-(d - 1) / tau);
}

// Daily cause-specific hazards for a program on a given calendar day (regime changes included).
export function trueHazards(program, sentDay) {
  const cat = CATEGORIES[program.category];
  let th = program.truth.help;
  let tf = program.truth.fail;
  if (program.truth.change && sentDay >= program.truth.change.day) {
    th *= program.truth.change.help;
    tf *= program.truth.change.fail;
  }
  const out = [];
  for (let d = 1; d <= MAX_FOLLOW; d++) {
    let h = th * baseHazard(cat.help, d);
    let f = tf * baseHazard(cat.fail, d);
    const s = h + f;
    if (s > 0.9) {
      h *= 0.9 / s;
      f *= 0.9 / s;
    }
    out.push([h, f]);
  }
  return out;
}

// Probability that a referral sent on sentDay records "Got help" within `horizon` days (truth).
export function trueCif(program, sentDay, horizon = 14) {
  const hz = trueHazards(program, sentDay);
  let S = 1;
  let cif = 0;
  for (let d = 1; d <= horizon; d++) {
    const [h, f] = hz[d - 1];
    cif += S * h;
    S *= 1 - h - f;
  }
  return cif;
}

const ORG_PROGRAMS = [
  // food pantry (search shown in the demo)
  ["food pantry", "Weekly Grocery Pantry", "Eastside Neighbors Alliance", "1601 E 7th St, Austin, TX 78702", 30.2622, -97.7247],
  ["food pantry", "Client-Choice Pantry", "Govalle Family Resource Center", "5200 Bolm Rd, Austin, TX 78721", 30.2561, -97.6977],
  ["food pantry", "Drive-Through Food Distribution", "Montopolis Community Pantry", "6800 Riverside Dr, Austin, TX 78741", 30.2317, -97.7019],
  ["food pantry", "Emergency Food Boxes", "St. Brigid Outreach Center", "2101 Manor Rd, Austin, TX 78722", 30.2841, -97.7186],
  ["food pantry", "Senior Grocery Program", "Riverside Senior Services", "1900 Willow Creek Dr, Austin, TX 78741", 30.2338, -97.7262],
  ["food pantry", "Mobile Food Pantry", "Hill Country Harvest Network", "4500 E Cesar Chavez St, Austin, TX 78702", 30.2493, -97.7066],
  ["food pantry", "Fresh Produce Market", "Rosewood Community Kitchen", "2300 Rosewood Ave, Austin, TX 78702", 30.2701, -97.7135],
  ["food pantry", "Family Food Pantry", "Holly Street Mutual Aid", "1200 Holly St, Austin, TX 78702", 30.2534, -97.7314],
  ["food pantry", "Campus Food Pantry", "Austin Learning Collaborative", "1801 E 51st St, Austin, TX 78723", 30.3069, -97.6961],
  ["food pantry", "Weekend Meal Bags", "Dove Springs Youth Partners", "5800 Teri Rd, Austin, TX 78744", 30.1948, -97.7448],
  ["food pantry", "Pantry Pickup Program", "North Lamar Community Church", "8800 N Lamar Blvd, Austin, TX 78753", 30.3561, -97.6964],
  ["food pantry", "Grocery Delivery for Homebound Adults", "Capital Area Meals Collective", "3300 E 12th St, Austin, TX 78702", 30.2765, -97.7064],
  ["food pantry", "Baby Formula and Diaper Pantry", "Little Steps Family Network", "1000 E 11th St, Austin, TX 78702", 30.2701, -97.7299],
  ["food pantry", "Veterans Food Pantry", "Lone Star Veterans Outreach", "7000 Ed Bluestein Blvd, Austin, TX 78723", 30.2953, -97.6672],
  ["food pantry", "Community Fridge Network", "Chestnut Neighborhood Project", "1700 Chestnut Ave, Austin, TX 78702", 30.2799, -97.7183],
  ["food pantry", "Halal Food Pantry", "Riverside Muslim Community Services", "2400 Wickersham Ln, Austin, TX 78741", 30.2282, -97.7155],
  ["food pantry", "South Austin Food Pantry", "South Congress Neighbors United", "4200 S Congress Ave, Austin, TX 78745", 30.2234, -97.7653],
  ["food pantry", "Pflugerville Area Pantry", "Pfluger Hills Helping Hands", "1400 W Pecan St, Pflugerville, TX 78660", 30.4404, -97.6386],
  // rent assistance
  ["rent assistance", "Emergency Rent Assistance", "Eastside Neighbors Alliance", "1601 E 7th St, Austin, TX 78702", 30.2622, -97.7247],
  ["rent assistance", "Eviction Prevention Fund", "Travis Housing Stability Partners", "1101 E 6th St, Austin, TX 78702", 30.2647, -97.7321],
  ["rent assistance", "First Month's Rent Program", "Capital Area Home Start", "3000 E Martin Luther King Jr Blvd, Austin, TX 78702", 30.2843, -97.7095],
  ["rent assistance", "Rental Arrears Help", "St. Brigid Outreach Center", "2101 Manor Rd, Austin, TX 78722", 30.2841, -97.7186],
  ["rent assistance", "Veterans Rent Relief", "Lone Star Veterans Outreach", "7000 Ed Bluestein Blvd, Austin, TX 78723", 30.2953, -97.6672],
  ["rent assistance", "Family Housing Stabilization", "Govalle Family Resource Center", "5200 Bolm Rd, Austin, TX 78721", 30.2561, -97.6977],
  ["rent assistance", "Senior Housing Assistance", "Riverside Senior Services", "1900 Willow Creek Dr, Austin, TX 78741", 30.2338, -97.7262],
  ["rent assistance", "Youth Housing Support", "Dove Springs Youth Partners", "5800 Teri Rd, Austin, TX 78744", 30.1948, -97.7448],
  ["rent assistance", "One-Time Rent Grant", "North Lamar Community Church", "8800 N Lamar Blvd, Austin, TX 78753", 30.3561, -97.6964],
  ["rent assistance", "Move-In Deposit Assistance", "Holly Street Mutual Aid", "1200 Holly St, Austin, TX 78702", 30.2534, -97.7314],
  ["rent assistance", "Domestic Violence Survivor Housing Fund", "Safe Harbor Austin Alliance", "1500 E Riverside Dr, Austin, TX 78741", 30.2453, -97.7341],
  ["rent assistance", "Medical Hardship Rent Help", "Capital Area Patient Support", "1313 Red River St, Austin, TX 78701", 30.2766, -97.7347],
  // utilities
  ["help pay for utilities", "Utility Bill Assistance", "Eastside Neighbors Alliance", "1601 E 7th St, Austin, TX 78702", 30.2622, -97.7247],
  ["help pay for utilities", "Energy Crisis Help", "Capital Area Home Start", "3000 E Martin Luther King Jr Blvd, Austin, TX 78702", 30.2843, -97.7095],
  ["help pay for utilities", "Water Bill Relief", "Montopolis Community Pantry", "6800 Riverside Dr, Austin, TX 78741", 30.2317, -97.7019],
  ["help pay for utilities", "Summer Cooling Assistance", "Riverside Senior Services", "1900 Willow Creek Dr, Austin, TX 78741", 30.2338, -97.7262],
  ["help pay for utilities", "Weatherization and Bill Help", "Travis Housing Stability Partners", "1101 E 6th St, Austin, TX 78702", 30.2647, -97.7321],
  ["help pay for utilities", "Disconnection Prevention", "St. Brigid Outreach Center", "2101 Manor Rd, Austin, TX 78722", 30.2841, -97.7186],
  ["help pay for utilities", "Internet Bill Discount Help", "Austin Learning Collaborative", "1801 E 51st St, Austin, TX 78723", 30.3069, -97.6961],
  ["help pay for utilities", "Veterans Utility Help", "Lone Star Veterans Outreach", "7000 Ed Bluestein Blvd, Austin, TX 78723", 30.2953, -97.6672],
  // transportation
  ["transportation", "Rides to Medical Appointments", "Capital Area Patient Support", "1313 Red River St, Austin, TX 78701", 30.2766, -97.7347],
  ["transportation", "Bus Pass Program", "Eastside Neighbors Alliance", "1601 E 7th St, Austin, TX 78702", 30.2622, -97.7247],
  ["transportation", "Senior Ride Program", "Riverside Senior Services", "1900 Willow Creek Dr, Austin, TX 78741", 30.2338, -97.7262],
  ["transportation", "Gas Card Assistance", "North Lamar Community Church", "8800 N Lamar Blvd, Austin, TX 78753", 30.3561, -97.6964],
  ["transportation", "Volunteer Driver Network", "Hill Country Harvest Network", "4500 E Cesar Chavez St, Austin, TX 78702", 30.2493, -97.7066],
  ["transportation", "Car Repair Assistance", "Holly Street Mutual Aid", "1200 Holly St, Austin, TX 78702", 30.2534, -97.7314],
  ["transportation", "Job Interview Rides", "Dove Springs Youth Partners", "5800 Teri Rd, Austin, TX 78744", 30.1948, -97.7448],
  ["transportation", "Veterans Transportation", "Lone Star Veterans Outreach", "7000 Ed Bluestein Blvd, Austin, TX 78723", 30.2953, -97.6672],
];

// Hand-set story programs (everything else is drawn from the seed).
const STORY = {
  // Busy, well-run pantry.
  "Weekly Grocery Pantry": { volume: 5.5, help: 1.45, fail: 0.8, resp: 1.5, claimed: true, featured: true },
  // Ran out of capacity about 110 days ago: recent referrals mostly close as "No capacity".
  "Client-Choice Pantry": {
    volume: 4.2, help: 1.3, fail: 0.9, resp: 1.3, claimed: true, featured: true,
    change: { daysAgo: 110, help: 0.33, fail: 2.6, reasons: [6, 1, 1, 1, 0.5, 1] },
  },
  // Rarely updates referrals, so most stay open; the few that close are "Got help".
  "Drive-Through Food Distribution": { volume: 3.6, help: 0.32, fail: 0.06, resp: 0.25, claimed: true, featured: false },
  // Tiny volume: shrinkage matters.
  "Emergency Food Boxes": { volume: 0.22, help: 1.6, fail: 0.4, resp: 1.2, claimed: true, featured: false },
  // Improved after adding a volunteer coordinator about 150 days ago.
  "Mobile Food Pantry": {
    volume: 2.4, help: 0.55, fail: 1.4, resp: 0.6, claimed: true, featured: false,
    change: { daysAgo: 150, help: 2.1, fail: 0.55, reasons: null },
  },
  "Senior Grocery Program": { volume: 1.6, help: 1.1, fail: 0.7, resp: 1.0, claimed: true, featured: false, serving: ["seniors", "adults"] },
  "Fresh Produce Market": { volume: 0, help: 1, fail: 1, resp: 1, claimed: false, featured: false },
  "Family Food Pantry": { volume: 2.0, help: 0.85, fail: 1.25, resp: 0.9, claimed: true, featured: false },
};

const SERVICE_TAGS = {
  "food pantry": [["food pantry", "emergency food"], ["food pantry", "fresh produce"], ["food pantry", "personal care items"], ["food pantry", "food delivery"], ["food pantry", "diapers & formula"]],
  "rent assistance": [["help pay for housing", "rent assistance"], ["help pay for housing", "eviction prevention"]],
  "help pay for utilities": [["help pay for utilities", "electric bill help"], ["help pay for utilities", "water bill help"]],
  transportation: [["transportation", "bus passes"], ["transportation", "medical transportation"]],
};

export function generate(seed = SEED) {
  const rng = mulberry32(seed);
  const programs = ORG_PROGRAMS.map((row, i) => {
    const [category, name, org, address, lat, lon] = row;
    const s = STORY[name];
    const claimed = s ? s.claimed : rng() < 0.82;
    const truth = {
      volume: s ? s.volume : Math.exp(Math.log(1.1) + 0.9 * normal(rng)),
      help: s ? s.help : Math.exp(0.5 * normal(rng)),
      fail: s ? s.fail : Math.exp(0.45 * normal(rng)),
      resp: s ? s.resp : Math.exp(0.5 * normal(rng)),
      reasons: [1.4, 1.6, 1.1, 0.9, 0.7, 0.6].map((w) => w * (0.6 + 0.8 * rng())),
      change: null,
    };
    if (category !== "food pantry" && !s && rng() < 0.12) truth.volume *= 0.12; // a few tiny programs
    if (s && s.change) {
      truth.change = { day: T_TODAY - s.change.daysAgo, help: s.change.help, fail: s.change.fail, reasons: s.change.reasons };
    }
    const tags = SERVICE_TAGS[category][Math.floor(rng() * SERVICE_TAGS[category].length)];
    return {
      id: "p" + String(i + 1).padStart(2, "0"),
      category,
      name,
      org,
      address,
      lat,
      lon,
      claimed,
      featured: s ? s.featured : rng() < 0.15,
      servesAnyone: s && s.serving ? false : rng() < 0.75,
      serving: s && s.serving ? s.serving : null,
      phone: "512-555-01" + String(10 + i).padStart(2, "0"),
      tags,
      reviewedDaysAgo: 20 + Math.floor(rng() * 300),
      truth,
    };
  });

  const referrals = [];
  let rid = 0;
  for (const p of programs) {
    if (!p.claimed || p.truth.volume <= 0) continue; // unclaimed programs get logged referrals only (no status tracking)
    const cat = CATEGORIES[p.category];
    for (let day = 0; day < T_TODAY; day++) {
      const dow = (day + 2) % 7; // 2025-05-20 was a Tuesday; 0 = Sunday
      const weekday = dow !== 0 && dow !== 6 ? 1.25 : 0.375;
      const n = poisson(rng, (p.truth.volume / 7) * weekday);
      for (let k = 0; k < n; k++) {
        const hz = trueHazards(p, day);
        let outcome = null;
        let outcomeDay = null;
        for (let d = 1; d <= MAX_FOLLOW; d++) {
          const u = rng();
          const [h, f] = hz[d - 1];
          if (u < h) {
            outcome = "help";
            outcomeDay = d;
            break;
          }
          if (u < h + f) {
            outcome = "fail";
            outcomeDay = d;
            break;
          }
        }
        // First status update by anyone: a pending/eligible update or the closing update, whichever comes first.
        let respDay = null;
        for (let d = 1; d <= MAX_FOLLOW; d++) {
          if (rng() < Math.min(0.9, p.truth.resp * baseHazard(cat.resp, d))) {
            respDay = d;
            break;
          }
        }
        if (outcomeDay !== null && (respDay === null || outcomeDay < respDay)) respDay = outcomeDay;
        let reason = null;
        if (outcome === "fail") {
          const w = p.truth.change && day >= p.truth.change.day && p.truth.change.reasons ? p.truth.change.reasons : p.truth.reasons;
          const tot = w.reduce((a, b) => a + b, 0);
          let u = rng() * tot;
          let j = 0;
          while (u > w[j] && j < w.length - 1) {
            u -= w[j];
            j++;
          }
          reason = FAIL_REASONS[j];
        }
        referrals.push({ id: ++rid, program: p.id, category: p.category, sent: day, outcome, outcomeDay, respDay, reason });
      }
    }
  }
  return { programs, referrals, today: T_TODAY };
}

export function dayToDate(day) {
  return new Date(DAY0 + day * 86400000);
}
