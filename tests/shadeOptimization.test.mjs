import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseBestShadeCandidate,
  chooseImprovingShadeCandidate,
  createShadeOptimizationPositions,
  SHADE_OPTIMIZATION_LIMITS,
} from '../src/park/shadeOptimization.ts';
import { CANOPY_TILT_LIMITS } from '../src/park/canopyDimensions.ts';
import { groundShadeCoverageCacheKey, sunPosition3d } from '../src/simulation.ts';
import {
  ADAPTIVE_SHADE_MINIMUM_IMPROVEMENT_PERCENT,
  ADAPTIVE_SHADE_TRIGGER_ANGLE_DEGREES,
  adaptiveShadeInputKey,
  adaptiveTargetForSun,
  calculateAdaptiveTargetPose,
  createAdaptiveShadeSearchCache,
  initialShadePoseEstimate,
  isAdaptiveShadeSearchCurrent,
  manualTimeChangeSearchAction,
  scheduleAdaptiveShadeSearch,
  shouldSearchAdaptiveShade,
  transitionAdaptiveControlMode,
  vectorAngleDegrees,
} from '../src/park/adaptiveShade.ts';

test('optimization selects the highest-coverage candidate that was evaluated', () => {
  const candidates = [
    { heading: -90, tilt: -15, coveragePercent: 45 },
    { heading: 15, tilt: 5, coveragePercent: 81.2 },
    { heading: 90, tilt: 15, coveragePercent: 79 },
  ];
  const result = chooseBestShadeCandidate(candidates, { heading: 0, tilt: 0 });
  assert.equal(result, candidates[1]);
});

test('equal coverage prefers the position nearest the current roof pose', () => {
  const candidates = [
    { heading: 15, tilt: 0, coveragePercent: 80 },
    { heading: -15, tilt: 0, coveragePercent: 80 },
    { heading: 75, tilt: 10, coveragePercent: 79 },
  ];
  const result = chooseBestShadeCandidate(candidates, { heading: 14, tilt: 0 });
  assert.equal(result, candidates[0]);
});

test('exactly tied candidates use a stable preference for milder tilt and heading', () => {
  const candidates = [
    { heading: -15, tilt: 5, coveragePercent: 50 },
    { heading: 15, tilt: -5, coveragePercent: 50 },
    { heading: 0, tilt: 10, coveragePercent: 50 },
  ];
  const result = chooseBestShadeCandidate(candidates, { heading: 0, tilt: 0 });
  assert.equal(result.heading, -15);
  assert.equal(result.tilt, 5);
});

test('candidate grid covers the full provisional tilt limits and includes an off-grid pose once', () => {
  const candidates = createShadeOptimizationPositions({ heading: 12, tilt: 3 });
  assert.equal(candidates.length, 170);
  assert.deepEqual(SHADE_OPTIMIZATION_LIMITS.tilt, { min: -30, max: 30, step: 5 });
  assert.deepEqual(CANOPY_TILT_LIMITS, { min: -30, max: 30 });
  assert.ok(candidates.some(candidate => candidate.tilt === -30));
  assert.ok(candidates.some(candidate => candidate.tilt === 30));
  assert.deepEqual(candidates.at(-1), { heading: 12, tilt: 3 });
  assert.equal(candidates.filter(candidate => candidate.heading === 12 && candidate.tilt === 3).length, 1);
  assert.ok(candidates.every(({ heading, tilt }) =>
    heading >= SHADE_OPTIMIZATION_LIMITS.heading.min
    && heading <= SHADE_OPTIMIZATION_LIMITS.heading.max
    && tilt >= SHADE_OPTIMIZATION_LIMITS.tilt.min
    && tilt <= SHADE_OPTIMIZATION_LIMITS.tilt.max));
  assert.throws(() => createShadeOptimizationPositions({ heading: 0, tilt: -30.1 }), RangeError);
  assert.throws(() => createShadeOptimizationPositions({ heading: 0, tilt: 30.1 }), RangeError);
});

test('an on-grid current pose is not duplicated and an empty result set is rejected', () => {
  const candidates = createShadeOptimizationPositions({ heading: 15, tilt: 5 });
  assert.equal(candidates.length, 169);
  assert.equal(candidates.filter(candidate => candidate.heading === 15 && candidate.tilt === 5).length, 1);
  assert.throws(() => chooseBestShadeCandidate([], { heading: 0, tilt: 0 }), RangeError);
});

test('adaptive optimization applies only a meaningful best evaluated improvement', () => {
  const candidates = [
    { heading: 0, tilt: 0, coveragePercent: 52.4 },
    { heading: 15, tilt: 10, coveragePercent: 53.3 },
    { heading: 30, tilt: -20, coveragePercent: 56.1 },
  ];
  assert.equal(ADAPTIVE_SHADE_MINIMUM_IMPROVEMENT_PERCENT, 1);
  assert.equal(chooseImprovingShadeCandidate(candidates, { heading: 0, tilt: 0 }, 52.4, 1), candidates[2]);
  assert.equal(chooseImprovingShadeCandidate(candidates.slice(0, 2), { heading: 0, tilt: 0 }, 52.4, 1), null);
});

test('adaptive search triggers on entry and meaningful sun movement, but not manual mode or night', () => {
  const noonSun = { x: 0, y: 1, z: 0 };
  const smallChange = { x: Math.sin(1 * Math.PI / 180), y: Math.cos(1 * Math.PI / 180), z: 0 };
  const meaningfulChange = { x: Math.sin(4 * Math.PI / 180), y: Math.cos(4 * Math.PI / 180), z: 0 };
  assert.equal(ADAPTIVE_SHADE_TRIGGER_ANGLE_DEGREES, 3);
  assert.equal(shouldSearchAdaptiveShade(true, true, noonSun, null), true);
  assert.equal(shouldSearchAdaptiveShade(true, true, smallChange, noonSun), false);
  assert.equal(shouldSearchAdaptiveShade(true, true, meaningfulChange, noonSun), true);
  assert.equal(shouldSearchAdaptiveShade(false, true, meaningfulChange, noonSun), false);
  assert.equal(shouldSearchAdaptiveShade(true, false, meaningfulChange, noonSun), false);
});

test('adaptive/manual transitions preserve the active target pose', () => {
  const current = { heading: 37, tilt: -20 };
  assert.deepEqual(transitionAdaptiveControlMode('adaptive', current), { mode: 'manual', pose: current });
  assert.deepEqual(transitionAdaptiveControlMode('manual', current), { mode: 'adaptive', pose: current });
});

test('adaptive search identity changes for every date, time, and location input', () => {
  const base = ['2026-10-21', 570, 3.139, 101.686];
  const key = adaptiveShadeInputKey(...base);
  for (const variant of [
    ['2026-10-22', 570, 3.139, 101.686],
    ['2026-10-21', 571, 3.139, 101.686],
    ['2026-10-21', 570, 3.14, 101.686],
    ['2026-10-21', 570, 3.139, 101.687],
  ]) assert.notEqual(adaptiveShadeInputKey(...variant), key);
});

test('adaptive search rejects disabled, cancelled, or outdated worker results', () => {
  const key = adaptiveShadeInputKey('2026-10-21', 570, 3.139, 101.686);
  const changedTime = adaptiveShadeInputKey('2026-10-21', 571, 3.139, 101.686);
  assert.equal(isAdaptiveShadeSearchCurrent(4, 4, key, key, true, { directSunAvailable: true }), true);
  assert.equal(isAdaptiveShadeSearchCurrent(3, 4, key, key, true), false);
  assert.equal(isAdaptiveShadeSearchCurrent(4, 4, key, changedTime, true), false);
  assert.equal(isAdaptiveShadeSearchCurrent(4, 4, key, changedTime, true, {
    allowClockDrift: true, sameContext: true, directSunAvailable: true,
  }), true);
  assert.equal(isAdaptiveShadeSearchCurrent(4, 4, key, changedTime, true, {
    allowClockDrift: true, sameContext: false, directSunAvailable: true,
  }), false);
  assert.equal(isAdaptiveShadeSearchCurrent(4, 4, key, changedTime, true, {
    allowClockDrift: true, sameContext: true, directSunAvailable: false,
  }), false);
  assert.equal(isAdaptiveShadeSearchCurrent(4, 4, key, key, false), false);
});

test('playback coalesces a meaningful sun change into one queued search', () => {
  const lastSearch = { x: 0, y: 1, z: 0 };
  const smallChange = { x: Math.sin(Math.PI / 180), y: Math.cos(Math.PI / 180), z: 0 };
  const meaningfulChange = { x: Math.sin(5 * Math.PI / 180), y: Math.cos(5 * Math.PI / 180), z: 0 };
  assert.equal(scheduleAdaptiveShadeSearch(true, true, smallChange, lastSearch, true), 'none');
  assert.equal(scheduleAdaptiveShadeSearch(true, true, meaningfulChange, lastSearch, true), 'queue');
  assert.equal(scheduleAdaptiveShadeSearch(true, true, meaningfulChange, lastSearch, false), 'start');
  assert.equal(scheduleAdaptiveShadeSearch(true, false, meaningfulChange, null, false), 'none');
  assert.equal(scheduleAdaptiveShadeSearch(false, true, meaningfulChange, null, true), 'none');
});

test('manual time edits force a fresh search below the playback angle threshold and defer during dragging', () => {
  const lastSearch = { x: 0.789245964, y: 0.574825134, z: -0.216025169 };
  const smallManualTimeChange = { x: 0.773635924, y: 0.595251394, z: -0.217170982 };
  assert.equal(scheduleAdaptiveShadeSearch(true, true, smallManualTimeChange, lastSearch, false), 'none');
  assert.equal(manualTimeChangeSearchAction(true, true), 'defer');
  assert.equal(manualTimeChangeSearchAction(true, false), 'search');
  assert.equal(manualTimeChangeSearchAction(false, false), 'none');
  // The settled manual edit clears the previous-sun baseline before invoking
  // the normal scheduler, so the explicit edit cannot be filtered by 3°.
  assert.equal(scheduleAdaptiveShadeSearch(true, true, smallManualTimeChange, null, false), 'start');
});

test('nighttime resets adaptive pose to neutral and sunrise schedules a fresh search', () => {
  const optimizedPose = { heading: -75, tilt: 25 };
  assert.deepEqual(adaptiveTargetForSun(true, false, optimizedPose), { heading: 0, tilt: 0 });
  const sunrise = { x: 0.5, y: 0.5, z: 0.7 };
  assert.equal(scheduleAdaptiveShadeSearch(true, false, sunrise, null, false), 'none');
  assert.equal(scheduleAdaptiveShadeSearch(true, true, sunrise, null, false), 'start');
});

test('nighttime handling preserves a manual canopy pose', () => {
  const manualPose = { heading: 42, tilt: -20 };
  assert.equal(adaptiveTargetForSun(false, false, manualPose), manualPose);
  assert.deepEqual(adaptiveTargetForSun(true, true, manualPose), manualPose);
});

test('the cache reuses exact candidate scores across sweeps and evicts least-recently-used entries', () => {
  const candidateCache = createAdaptiveShadeSearchCache(512);
  const candidateKey = groundShadeCoverageCacheKey({
    date: '2026-10-21', minute: 570, latitude: 3.139, longitude: 101.686, angle: -5, heading: 15,
  });
  candidateCache.set(candidateKey, 43.2);
  assert.equal(candidateCache.get(groundShadeCoverageCacheKey({
    date: '2026-10-21', minute: 570, latitude: 3.139, longitude: 101.686, angle: -5, heading: 15,
  })), 43.2);
  assert.equal(candidateCache.get(groundShadeCoverageCacheKey({
    date: '2026-10-21', minute: 570, latitude: 3.139, longitude: 101.686, angle: 0, heading: 15,
  })), undefined);
  assert.equal(candidateCache.get(groundShadeCoverageCacheKey({
    date: '2026-10-21', minute: 571, latitude: 3.139, longitude: 101.686, angle: -5, heading: 15,
  })), undefined);

  const cache = createAdaptiveShadeSearchCache(2);
  const first = [{ heading: 0, tilt: 0, coveragePercent: 25 }];
  const second = [{ heading: 15, tilt: 5, coveragePercent: 40 }];
  cache.set('morning', first);
  cache.set('afternoon', second);
  assert.equal(cache.get('morning'), first);
  cache.set('evening', []);
  assert.equal(cache.get('morning'), first);
  assert.equal(cache.get('afternoon'), undefined);
  assert.deepEqual(cache.get('evening'), []);
  assert.throws(() => createAdaptiveShadeSearchCache(0), RangeError);
});

test('fast initial shade pose estimate responds within provisional limits and parks at night', () => {
  // Nighttime (sun below horizon)
  const nightEstimate = initialShadePoseEstimate(false, { x: 0, y: -0.5, z: 0 }, -30);
  assert.deepEqual(nightEstimate, { heading: 0, tilt: 0 });

  // Morning sun in East (+X)
  const morningSun = { x: 0.8, y: 0.5, z: 0.2 };
  const morningEstimate = initialShadePoseEstimate(true, morningSun, 30);
  assert.ok(morningEstimate.heading >= -90 && morningEstimate.heading <= 90);
  assert.ok(morningEstimate.tilt >= -30 && morningEstimate.tilt <= 30);
  // Negative tilt points roof normal towards East
  assert.ok(morningEstimate.tilt < 0, `Expected morning tilt < 0, got ${morningEstimate.tilt}`);

  // Afternoon sun in West (-X)
  const afternoonSun = { x: -0.8, y: 0.5, z: 0.2 };
  const afternoonEstimate = initialShadePoseEstimate(true, afternoonSun, 30);
  assert.ok(afternoonEstimate.heading >= -90 && afternoonEstimate.heading <= 90);
  assert.ok(afternoonEstimate.tilt >= -30 && afternoonEstimate.tilt <= 30);
  // Positive tilt points roof normal towards West
  assert.ok(afternoonEstimate.tilt > 0, `Expected afternoon tilt > 0, got ${afternoonEstimate.tilt}`);
});

test('adaptive search rejects stale worker results when sun drift exceeds trigger angle', () => {
  const key = adaptiveShadeInputKey('2026-10-21', 570, 3.139, 101.686);
  const changedTime = adaptiveShadeInputKey('2026-10-21', 610, 3.139, 101.686);
  const searchSun = { x: 0.78, y: 0.58, z: -0.21 };
  // Small drift (< 3 degrees)
  const smallDriftSun = { x: 0.77, y: 0.59, z: -0.21 };
  // Large drift (>= 3 degrees, e.g. 10 degrees)
  const largeDriftSun = { x: 0.65, y: 0.72, z: -0.21 };
  assert.equal(isAdaptiveShadeSearchCurrent(1, 1, key, changedTime, true, {
    allowClockDrift: true,
    sameContext: true,
    directSunAvailable: true,
    searchSun,
    currentSun: smallDriftSun,
    maxDriftDegrees: 3,
  }), true);
  assert.equal(isAdaptiveShadeSearchCurrent(1, 1, key, changedTime, true, {
    allowClockDrift: true,
    sameContext: true,
    directSunAvailable: true,
    searchSun,
    currentSun: largeDriftSun,
    maxDriftDegrees: 3,
  }), false);
});

test('calculateAdaptiveTargetPose combines fast initial estimate with refinement offset and clamps to provisional limits', () => {
  const fast = { heading: -90, tilt: -25 };
  // Zero refinement
  assert.deepEqual(calculateAdaptiveTargetPose(fast, { heading: 0, tilt: 0 }, true), fast);
  // Null refinement
  assert.deepEqual(calculateAdaptiveTargetPose(fast, null, true), fast);
  // Applied refinement
  assert.deepEqual(calculateAdaptiveTargetPose(fast, { heading: 15, tilt: -3 }, true), { heading: -75, tilt: -28 });
  // Clamping to provisional limits: tilt [-30, 30], heading [-90, 90]
  assert.deepEqual(calculateAdaptiveTargetPose(fast, { heading: -20, tilt: -10 }, true), { heading: -90, tilt: -30 });
  assert.deepEqual(calculateAdaptiveTargetPose({ heading: 85, tilt: 28 }, { heading: 20, tilt: 10 }, true), { heading: 90, tilt: 30 });
  // Nighttime / sun below horizon returns neutral
  assert.deepEqual(calculateAdaptiveTargetPose(fast, { heading: 15, tilt: -5 }, false), { heading: 0, tilt: 0 });
});

test('playback simulation advances canopy target continuously with changing sun position', () => {
  // Across successive minutes during playback, canopy angle updates continuously
  const poses = [];
  for (let m = 564; m <= 580; m += 2) {
    const pos = sunPosition3d('2026-10-21', m, 3.139, 101.686);
    const fast = initialShadePoseEstimate(pos.rawElevation > 0, pos.vector, pos.elevation);
    const target = calculateAdaptiveTargetPose(fast, { heading: 5, tilt: -2 }, pos.rawElevation > 0);
    poses.push({ minute: m, target });
  }
  // Verify each step produces a changing target (canopy is never frozen during playback)
  for (let i = 1; i < poses.length; i++) {
    const prev = poses[i - 1].target;
    const curr = poses[i].target;
    assert.notDeepEqual(prev, curr, `Canopy pose at minute ${poses[i].minute} should differ from minute ${poses[i - 1].minute}`);
  }
});
