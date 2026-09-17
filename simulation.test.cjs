const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const script = html.split("<script>")[1].split("</script>")[0];
const model = new Function(
  script.slice(0, script.indexOf("      const groups =")) +
    "return { DEFAULTS, CONSTANTS, tradeCalibration, createRng, simulatePath, runSimulation, buildHourlyCandles };",
)();
const {
  DEFAULTS,
  CONSTANTS,
  tradeCalibration,
  createRng,
  simulatePath,
  runSimulation,
  buildHourlyCandles,
} = model;

test("default calibration counts 30 completed cycles over 500 trading hours", () => {
  assert.equal(DEFAULTS.observedAvgTrades, 30);
  assert.deepEqual(tradeCalibration(DEFAULTS), {
    referenceTradingHours: 500,
    tradeRatePerHour: 0.06,
  });
  assert.ok(!html.includes("gridSpacing"));
});

test("sampled completed trades scale with path duration and produce PnL once", () => {
  for (const hours of [250, 500, 750]) {
    const params = { ...DEFAULTS, annualVol: 0, annualDrift: 3640, topDist: hours };
    const priceRng = createRng(123);
    const tradeRng = createRng(456);
    let total = 0;
    const samples = 4000;
    for (let i = 0; i < samples; i++) {
      const result = simulatePath(params, priceRng, tradeRng);
      assert.equal(result.hours, hours);
      assert.equal(result.outcome, "TOP");
      assert.equal(result.gridPnl, result.trades * params.gridProfit);
      assert.equal(result.finalPnl, result.gridPnl + params.topPnl);
      total += result.trades;
    }
    const expected = hours * 0.06;
    const tolerance = 6 * Math.sqrt(hours * 0.06 * 0.94 / samples);
    assert.ok(Math.abs(total / samples - expected) < tolerance);
  }
});

test("seeded simulations repeat and calibration never changes boundary paths", () => {
  const params = { ...DEFAULTS, topDist: 1, bottomDist: 1 };
  const first = runSimulation(params, createRng(789));
  assert.deepEqual(runSimulation(params, createRng(789)), first);
  const changed = runSimulation(
    { ...params, observedAvgTrades: 1000, observedCalendarDays: 10 }, createRng(789),
  );
  const boundaries = (result) => result.paths.map(({ hours, outcome }) => ({ hours, outcome }));
  assert.deepEqual(boundaries(changed), boundaries(first));
  for (const seed of [1, 2, 3]) {
    const low = simulatePath(params, createRng(seed), { random: () => 0 });
    const high = simulatePath(params, createRng(seed), { random: () => 0.99 });
    assert.equal(low.hours, high.hours);
    assert.equal(low.outcome, high.outcome);
    assert.equal(low.trades, low.hours);
    assert.equal(high.trades, 0);
  }
});

test("zero rate, rates above one, and stationary safety paths follow calibration", () => {
  const params = { ...DEFAULTS, annualVol: 0, annualDrift: 3640, topDist: 10 };
  assert.equal(simulatePath({ ...params, observedAvgTrades: 0 }, createRng(1)).trades, 0);
  assert.equal(simulatePath({ ...params, observedAvgTrades: 1000 }, createRng(1)).trades, 20);
  const stationary = simulatePath(
    { ...params, annualDrift: 0, observedAvgTrades: 500 }, createRng(1),
  );
  assert.equal(stationary.outcome, "SAFETY_LIMIT");
  assert.equal(stationary.hours, CONSTANTS.SAFETY_MAX_HOURS);
  assert.equal(stationary.trades, CONSTANTS.SAFETY_MAX_HOURS);
  assert.equal(stationary.gridPnl, stationary.trades * params.gridProfit);
  assert.equal(stationary.finalPnl, null);
});

test("visualization history retains hour zero, terminal data, and clips only the displayed close", () => {
  const params = { ...DEFAULTS, annualVol: 0, annualDrift: 10920, topDist: 10 };
  const path = simulatePath(params, createRng(1), { random: () => 0 }, true);
  assert.equal(path.outcome, "TOP");
  assert.equal(path.hours, 4);
  assert.equal(path.hourlyHistory[0].hour, 0);
  assert.equal(path.hourlyHistory.length, path.hours + 1);
  assert.equal(path.hourlyHistory.at(-1).hour, path.hours);
  assert.equal(path.terminalProposedDisplacement, 12);
  assert.equal(path.terminalCompletedCycles, path.hourlyHistory.at(-1).completedCycles);
  assert.equal(
    path.hourlyHistory.reduce((sum, point) => sum + point.completedCycles, 0),
    path.trades,
  );

  const candles = buildHourlyCandles({
    hourlyHistory: path.hourlyHistory,
    boundaryReached: path.outcome,
    duration: path.hours,
  }, params);
  assert.equal(candles.length, path.hours + 1);
  assert.equal(candles[0].hour, 0);
  assert.equal(candles.at(-1).open, 109);
  assert.equal(candles.at(-1).proposedClose, 112);
  assert.equal(candles.at(-1).close, 110);
  assert.equal(candles.at(-1).high, 110);
  assert.equal(candles.at(-1).low, 109);
  assert.equal(candles.at(-1).isClipped, true);
  assert.equal(candles.at(-1).displayedMovementPercent, (1 / 109) * 100);
});

test("reservoir-selected visualization is deterministic and does not depend on trade calibration", () => {
  const params = { ...DEFAULTS, topDist: 1, bottomDist: 1, seed: 9876 };
  const first = runSimulation(params, createRng(9876));
  const repeated = runSimulation(params, createRng(9876));
  assert.deepEqual(repeated.visualizationPath, first.visualizationPath);

  const changedTrades = runSimulation(
    { ...params, observedAvgTrades: 1000, observedCalendarDays: 10 },
    createRng(9876),
  );
  assert.deepEqual(
    changedTrades.visualizationPath.hourlyHistory.map(({ hour, displacement }) => ({ hour, displacement })),
    first.visualizationPath.hourlyHistory.map(({ hour, displacement }) => ({ hour, displacement })),
  );
  assert.equal(changedTrades.visualizationPath.boundaryReached, first.visualizationPath.boundaryReached);
  assert.equal(changedTrades.visualizationPath.duration, first.visualizationPath.duration);
});

test("a completed path keeps every hourly point without truncation", () => {
  const params = { ...DEFAULTS, annualVol: 0, annualDrift: 3640, topDist: 400 };
  const path = simulatePath(params, createRng(2), { random: () => 0 }, true);
  assert.equal(path.outcome, "TOP");
  assert.equal(path.hours, 400);
  assert.equal(path.hourlyHistory.length, 401);
  assert.equal(path.hourlyHistory.at(-1).hour, 400);
});

test("no boundary-completed paths produce no visualization path", () => {
  const originalPathCount = CONSTANTS.NUM_PATHS;
  CONSTANTS.NUM_PATHS = 2;
  try {
    const result = runSimulation(
      { ...DEFAULTS, annualVol: 0, annualDrift: 0 },
      createRng(3),
    );
    assert.equal(result.visualizationPath, null);
  } finally {
    CONSTANTS.NUM_PATHS = originalPathCount;
  }
});
