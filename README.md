# Referral outlook (concept for Findhelp)

**Live demo:** https://mohith26.github.io/findhelp-referral-outlook/ (add `#accuracy` to open the backtest)

An unofficial concept feature for the Findhelp staff site: every program card in search results
gets a **Referral outlook**, the chance that a referral sent today records **Got help** within 14
days, how soon someone usually updates it, and a warning when a program's outcomes recently changed.
Checking two or more cards shows the chance that at least one of them helps, and suggests a swap.

Unofficial concept demo by Mohith Gajjela. Not affiliated with Findhelp. Synthetic data: the
programs and organizations are fictional and their numbers describe no real CBO.

## Why

Navigators pick between programs that look the same on paper. Findhelp already tracks every closed
loop (Not updated, Pending, Eligible, then Got help or one of six closed-without-help statuses), and
the referral dashboards report status breakdowns after the fact. Relevance ranking uses keyword
match, featured, claimed and location. Nothing turns that outcome history into a forecast at the
moment someone is choosing where to refer.

The obvious number, the share of closed referrals that got help, is misleading because many
referrals never close. In the demo, Drive-Through Food Distribution shows 95% on that measure,
but 215 of its 273 referrals are still open and only 19% of new referrals record Got help within
two weeks. (A 2026 study of 4,258 housing referrals in NYC's WholeYouNYC network found 32% still
awaiting a response; it's a real pattern, not a demo artifact.)

## How it works

`src/outlook.js`, no dependencies.

1. **Censoring.** As of any date, a referral either closed on day d (Got help, or closed without
   help) or is still open and counts only for the days it has been open. Open referrals are never
   treated as failures or dropped.
2. **Category baseline.** Discrete-time cause-specific hazards for Got help and closed-without-help,
   pooled over all programs in the category (Nelson-Aalen style, light smoothing past day 8,
   recency weight with a 365-day half-life).
3. **Program frailty with empirical Bayes.** Each program scales the baseline by theta per cause.
   With observed events O and expected events E, theta ~ Gamma(alpha + O, alpha + E). Weighted
   counts are converted to effective counts (E/E2) so the update sees the right noise; alpha comes
   from a method-of-moments estimate of the between-program spread, pooled across categories.
   Small programs are pulled toward similar programs; busy ones barely move.
4. **Forecast.** Aalen-Johansen cumulative incidence of Got help by day 14 from the program's
   hazards; 80% range from 400 posterior draws. A separate single-cause model gives the median
   time to the first status update.
5. **Change check.** For each program, a Poisson likelihood-ratio scan over weekly split points
   (4 to 43 weeks back, both causes, 2 df). Above 12, the program is flagged and the outlook uses
   only referrals since the split. In no-change simulations 12 flags about 1.4% of stable programs.
6. **Selection.** Chance at least one of the checked programs helps = 1 - prod(1 - p), assuming
   independence; the swap suggestion replaces the weakest pick with the best tracked pantry no
   farther than the farthest pick plus a mile.

Unclaimed programs get no outlook (their referrals are logged, not tracked).

## What the demo shows (all computed in the browser, reproducible with `node scripts/report.mjs`)

46 programs (18 food pantries near 78702), 5,518 referrals from May 20 2025 to Nov 10 2026.

- **Weekly Grocery Pantry:** 54% within 14 days (51-57%), first update in about 2 days.
- **Client-Choice Pantry:** 21% (15-28%). A capacity crunch starts Jul 23 in the simulator; the
  change check places it at Jul 14 and the card says most referrals now close as "No capacity".
  Its closed-referral share still says 75%.
- **Drive-Through Food Distribution:** 19%, first update after about 23 days; closed-referral
  share 95%.
- **Selection:** Weekly Grocery + Client-Choice gives 64%; swapping Client-Choice for Grocery
  Delivery for Homebound Adults (1.0 mi) gives 78%.

**Backtest** (6 rolling cutoffs, 5 weeks apart, 2,124 held-out referrals; the model only sees
what was known at each cutoff):

| Average error, points | vs. true rate | programs with <60 referrals | vs. observed share | Brier |
|---|---|---|---|---|
| Referral outlook | 4.2 | 6.4 | 10.5 | 0.217 |
| Same model, no shrinkage | 4.3 | 7.5 | 10.5 | 0.218 |
| Got-help share of closed referrals | 31.3 | 26.4 | 32.2 | 0.340 |

"True rate" is the simulator's own probability (only available on synthetic data). Observed
shares come from 5-30 held-out referrals per program and cutoff, so even a perfect forecast shows
error there. Calibration bins (shown in the demo) sit within 5 points of the diagonal.

## Tests

`node --test test/outlook.test.mjs` (11 tests, under a second):

- deterministic generator; cumulative incidence identities (geometric single cause; causes plus open sum to 1);
- baseline hazards recover the true rate under heavy censoring, where the closed-only share answers a different question;
- gamma sampler moments; method-of-moments alpha recovers a known spread;
- small programs move toward their category under shrinkage and get wider ranges; unclaimed programs get no forecast;
- change check: under 3% false flags on stable programs across 6 fresh seeds, and the capacity drop is located within 3 weeks of the truth;
- backtest: error vs truth under 5 points, shrinkage beats no shrinkage on small programs, bins within 7 points of observed.

## Honest limitations

- Synthetic data. Real referral logs have messier statuses (navigators closing loops in bulk,
  CBOs updating weeks late), and the proportional-hazards assumption (each program scales one
  category curve) needs checking on real data.
- "Got help" means the status was recorded. A program that helps people but never updates
  Findhelp will look worse than it is; the card says when a program rarely updates.
- Independence across programs in the selection math is an approximation; programs that share a
  bottleneck (the same food bank supply, say) fail together.
- The change check finds sharp drops faster than slow improvements. In the demo, Mobile Food
  Pantry improved in June and isn't flagged yet (statistic 9.3, below 12), so its outlook lags.
- Outcome forecasts could steer referrals away from new or small CBOs. Shrinkage helps (a small
  program starts at its category's level, not zero), but a real version should watch for that.
- The map uses OpenStreetMap through Leaflet; the production site uses Google Maps.

## Novelty

I checked Findhelp's support library (program cards, referral statuses, the Referral Activity,
Group-Based Referral, Claimed Programs, Site Activity and Search Activity dashboards), the July 2026
AI Navigation Assistant beta post, customer how-to guides and training decks describing relevance
(keyword, featured, claimed, location). Findhelp reports outcomes descriptively; I found no
per-program forecast at the point of referral, no censoring-aware rate and no change alerts.
Unite Us publishes network-wide acceptance rates and response times in its reports and
dashboards, also descriptive.

## Files

- `index.html`, `styles.css`, `app.js`: the staff-site search page (CDN: Source Sans Pro,
  Font Awesome 4.7, Leaflet). Findhelp's logo and category icon font are used so the page reads
  like the product it's addressed to.
- `src/generate.js`: seeded synthetic network (seed 20261110).
- `src/outlook.js`: the model, change check and backtest.
- `scripts/report.mjs`: prints every number above.
