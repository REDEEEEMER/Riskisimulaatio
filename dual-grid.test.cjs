const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { createHash } = require("node:crypto");
const html = fs.readFileSync(`${__dirname}/index.html`, "utf8");
const script = html.split("<script>")[1].split("</script>")[0];
const model = new Function(script.slice(0, script.indexOf("      const groups =")) +
  "return { DEFAULTS, CONSTANTS, createRng, simulatePath, simulateGridB, runSimulation, summarizeDual };")();
const { DEFAULTS, CONSTANTS, createRng, simulatePath, simulateGridB, runSimulation, summarizeDual } = model;
CONSTANTS.NUM_PATHS = 40;
const base = { ...DEFAULTS, topDist: 1, bottomDist: 1, seed: 987 };
const config = overrides => ({ ...DEFAULTS, enabled: true, relationship: "same", startMode: "trigger", trigger: 101, rho: 0, ...overrides });
const run = p => runSimulation(p, createRng(987));

test("exact pre-feature seeded regression including selected visualization and statistics", () => {
  const result = run(base);
  if (process.env.GRID_BASELINE) {
    const oldHtml = fs.readFileSync(process.env.GRID_BASELINE, "utf8");
    const oldScript = oldHtml.split("<script>")[1].split("</script>")[0];
    const old = new Function(oldScript.slice(0, oldScript.indexOf("      const groups =")) +
      "return { CONSTANTS, runSimulation, createRng };")();
    old.CONSTANTS.NUM_PATHS = CONSTANTS.NUM_PATHS;
    assert.deepEqual(result, old.runSimulation(base, old.createRng(987)));
  }
  const digest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
  assert.equal(digest, "53d16d3251cf9b6e44d18b5e4046884bc56409fd6ae9c0cd5fc97f974748439b");
});

test("B cannot change any A result and complete dual runs repeat exactly", () => {
  const original = run(base);
  for (const relationship of ["same", "different"]) {
    const p = { ...base, gridB: config({ relationship, topDist: 2, bottomDist: 2 }) };
    const dual = run(p);
    assert.deepEqual(dual.paths, original.paths);
    assert.deepEqual(dual.stats, original.stats);
    assert.deepEqual(dual.visualizationPath, original.visualizationPath);
    assert.deepEqual(run(p), dual);
  }
});

function scenario({ trigger = 105, topDist = 10, move = 2, b = {}, a = {} } = {}) {
  const p = { ...DEFAULTS, annualVol: 0, annualDrift: move * 3640, topDist, ...a,
    gridB: config({ trigger, topDist: 8, bottomDist: 12, ...b }) };
  const shocks = [];
  const rng = { normal() { shocks.push(1); return 1; } };
  const gridA = simulatePath(p, rng, createRng(42), true);
  const result = simulateGridB(p, gridA, shocks, { normal: () => 0 }, createRng(43), { normal: () => 1 });
  return { p, gridA, ...result };
}

test("trigger 100 is immediate; exact touch, overshoot, and downward triggers activate", () => {
  assert.equal(scenario({ trigger: 100 }).gridB.activationHour, 0);
  assert.equal(scenario({ trigger: 104 }).gridB.activationHour, 2);
  const overshoot = scenario();
  assert.equal(overshoot.gridB.activationHour, 3);
  assert.equal(overshoot.gridB.startPrice, 106);
  assert.equal(overshoot.gridB.upper, 114);
  assert.equal(overshoot.gridB.lower, 94);
  assert.equal(overshoot.gridB.hourlyHistory[1].hour, 4);
  assert.equal(scenario({ trigger: 95, move: -2 }).gridB.startPrice, 94);
});

test("trigger at A boundary activates, beyond absorbing boundary does not", () => {
  const simultaneous = scenario({ trigger: 104, topDist: 4, move: 6 });
  assert.equal(simultaneous.gridA.hours, 1);
  assert.equal(simultaneous.gridB.activationHour, 1);
  assert.equal(simultaneous.gridB.startPrice, 106);
  assert.equal(simultaneous.gridB.hourlyHistory[1].hour, 2);
  const beyond = scenario({ trigger: 105, topDist: 4, move: 6 });
  assert.equal(beyond.gridB.outcome, "NOT_ACTIVATED");
  assert.equal(beyond.gridB.hours, null);
  assert.equal(beyond.gridB.finalPnl, null);
  assert.equal(beyond.gridB.trades, 0);
  assert.equal(beyond.finalPnl, beyond.gridA.finalPnl);
});

test("same market ignores B drift/volatility and B survives A on global clock", () => {
  const result = scenario({ b: { annualVol: 999, annualDrift: -999 } });
  assert.equal(result.gridA.hours, 5);
  assert.equal(result.gridB.hours, 4);
  assert.equal(result.hours, 7);
  for (const point of result.gridB.hourlyHistory.filter(p => p.hour <= result.gridA.hours))
    assert.equal(point.price, 100 + result.gridA.hourlyHistory[point.hour].displacement);
  assert.equal(result.gridB.hourlyHistory.at(-1).price, 114);
});

test("different instruments start at 100 and use correlated standardized shocks", () => {
  for (const rho of [-1, 0, 1]) {
    const result = scenario({ b: { relationship: "different", rho, annualVol: Math.sqrt(3640), annualDrift: 0,
      topDist: 2, bottomDist: 2 } });
    assert.equal(result.gridB.startPrice, 100);
    assert.equal(result.gridB.hourlyHistory[1].price, 100 + rho);
    if (rho === -1) assert.equal(result.gridB.outcome, "BOTTOM");
    if (rho === 1) assert.equal(result.gridB.outcome, "TOP");
  }
});

test("safety limit excludes unfinished PnL and distinguishes pending from active B", () => {
  const pending = scenario({ move: 0 });
  assert.equal(pending.gridB.outcome, "NOT_ACTIVATED_SAFETY_LIMIT");
  assert.equal(pending.gridB.activationHour, null);
  assert.equal(pending.finalPnl, null);
  const active = scenario({ move: 0, trigger: 100 });
  assert.equal(active.gridB.outcome, "SAFETY_LIMIT");
  assert.equal(active.gridB.hours, CONSTANTS.SAFETY_MAX_HOURS);
  assert.equal(active.gridB.finalPnl, null);
  assert.equal(summarizeDual([active]).meanPnl, null);
  const late = scenario({ topDist: 4, b: { relationship: "different", annualVol: 0, annualDrift: 0 }, trigger: 104 });
  assert.equal(late.gridA.outcome, "TOP");
  assert.equal(late.finalPnl, null);
  assert.equal(late.gridB.hours, CONSTANTS.SAFETY_MAX_HOURS - 2);
});

test("zero activations have unavailable B stats and valid combined A PnL", () => {
  const result = run({ ...base, gridB: config({ trigger: 105 }) });
  assert.equal(result.activationRate, 0);
  for (const value of Object.values(result.gridBStats)) assert.equal(value, null);
  assert.deepEqual(result.portfolios.map(p => p.finalPnl), result.paths.map(p => p.finalPnl));
});

test("B can finish first without further trades while A continues", () => {
  const result = scenario({ b: { startMode: "immediate", topDist: 2, observedAvgTrades: 500 } });
  assert.equal(result.gridB.hours, 1);
  assert.equal(result.gridB.trades, 1);
  assert.equal(result.gridB.hourlyHistory.length, 2);
  assert.equal(result.hours, result.gridA.hours);
  assert.equal(result.finalPnl, result.gridA.finalPnl + result.gridB.finalPnl);
});

test("correlation applies to shocks with each instrument's own drift and volatility", () => {
  const p = { ...DEFAULTS, topDist: 1, bottomDist: 1, annualDrift: 3640, annualVol: Math.sqrt(3640),
    gridB: config({ relationship: "different", startMode: "immediate", annualVol: 2 * Math.sqrt(3640), annualDrift: 3640 }) };
  const gridA = simulatePath(p, { normal: () => 2 }, createRng(1), true);
  for (const rho of [-1, 0, 0.4, 1]) {
    p.gridB.rho = rho;
    const result = simulateGridB(p, gridA, [2], { normal: () => 3 }, createRng(2), { normal: () => 2 });
    assert.equal(result.gridB.hourlyHistory[1].price, 101 + 2 * (rho * 2 + Math.sqrt(1 - rho * rho) * 3));
  }
});

test("B population denominators exclude nonactivation and PnL excludes safety", () => {
  const stats = summarizeDual([
    { outcome: "TOP", finalPnl: 10, hours: 4, trades: 2 },
    { outcome: "BOTTOM", finalPnl: -30, hours: 8, trades: 4 },
    { outcome: "SAFETY_LIMIT", finalPnl: null, hours: 20000, trades: 9 },
  ]);
  assert.equal(stats.topRate, 1 / 3);
  assert.equal(stats.safetyRate, 1 / 3);
  assert.equal(stats.meanPnl, -10);
  assert.equal(stats.lossRate, 0.5);
  assert.equal(stats.meanHours, 6);
  assert.equal(stats.avgTrades, 5);
  assert.equal(stats.avgCompletedTrades, 3);
});

test("activation at the global safety hour receives no extra B steps", () => {
  const result = scenario({ move: 1, topDist: CONSTANTS.SAFETY_MAX_HOURS, trigger: 100 + CONSTANTS.SAFETY_MAX_HOURS });
  assert.equal(result.gridA.outcome, "TOP");
  assert.equal(result.gridB.activationHour, CONSTANTS.SAFETY_MAX_HOURS);
  assert.equal(result.gridB.hours, 0);
  assert.equal(result.gridB.trades, 0);
  assert.equal(result.gridB.outcome, "SAFETY_LIMIT");
  assert.equal(result.finalPnl, null);
});

test("continuation snapshot preserves cached normals without advancing A's stream", () => {
  for (const draws of [1, 2]) {
    const rng = createRng(987);
    for (let i = 0; i < draws; i++) rng.normal();
    const continuation = rng.clone();
    const expected = rng.clone();
    for (let i = 0; i < 10; i++) assert.equal(continuation.normal(), expected.normal());
    assert.equal(rng.normal(), createExpected(draws));
  }
  function createExpected(draws) {
    const rng = createRng(987);
    for (let i = 0; i < draws; i++) rng.normal();
    return rng.normal();
  }
});
