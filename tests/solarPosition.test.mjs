import assert from 'node:assert/strict';
import test from 'node:test';
import {
  daylight,
  isDay,
  isNight,
  MYT_STANDARD_MERIDIAN,
  mytToUtc,
  automaticAngle,
  solarOutput,
  sunGeometry,
  sunPosition3d,
} from '../src/simulation.ts';
import { CANOPY_TILT_LIMITS } from '../src/park/canopyDimensions.ts';

const closeTo = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`);
};

test('automatic angle remains inside the shared provisional tilt limits', () => {
  assert.deepEqual(CANOPY_TILT_LIMITS, { min: -30, max: 30 });
  for (const hour of [0, 6, 9, 12, 15, 18, 24]) {
    for (const temperature of [20, 32, 33, 42]) {
      const angle = automaticAngle(hour, temperature);
      assert.ok(angle >= CANOPY_TILT_LIMITS.min && angle <= CANOPY_TILT_LIMITS.max);
    }
  }
  // Widening the allowed range does not otherwise change the existing auto policy.
  assert.equal(automaticAngle(18, 33), 13);
});

test('MYT civil date and time convert to UTC across year and leap-day boundaries', () => {
  assert.equal(mytToUtc('2026-01-01', 0).toISOString(), '2025-12-31T16:00:00.000Z');
  assert.equal(mytToUtc('2024-03-01', 7 * 60 + 59).toISOString(), '2024-02-29T23:59:00.000Z');
  assert.equal(mytToUtc('2024-03-01', 8 * 60).toISOString(), '2024-03-01T00:00:00.000Z');
});

test('NOAA solar equations reproduce the published NREL SPA Golden, Colorado reference', () => {
  // NREL SPA example: 2003-10-17 12:30:30 MST = 2003-10-18 03:30:30 MYT.
  // Reference: NREL/TP-560-34302, Solar Position Algorithm, example results.
  const position = sunPosition3d('2003-10-18', 3 * 60 + 30.5, 39.742476, -105.1786);
  assert.equal(position.utcDateTime, '2003-10-17T19:30:30.000Z');
  closeTo(position.azimuth, 194.34024, 0.35, 'azimuth degrees clockwise from north');
  closeTo(position.rawElevation, 90 - 50.11162, 0.35, 'geometric elevation degrees');
});

test('MYT standard meridian is 120 degrees east and longitude shifts apparent solar time', () => {
  assert.equal(MYT_STANDARD_MERIDIAN, 120);
  const meridian = sunPosition3d('2026-03-20', 12 * 60, 0, 120);
  const kualaLumpur = sunPosition3d('2026-03-20', 12 * 60, 0, 101.686);
  closeTo(kualaLumpur.solarTimeOffsetMinutes - meridian.solarTimeOffsetMinutes, -73.256, 1e-9,
    'Kuala Lumpur longitude correction');
  closeTo(kualaLumpur.hourAngleDegrees - meridian.hourAngleDegrees, -18.314, 1e-9,
    'hour-angle change from longitude');
});

test('date changes affect declination and the resulting sun position', () => {
  const equinox = sunPosition3d('2026-03-20', 12 * 60, 3.139, 101.686);
  const solstice = sunPosition3d('2026-06-21', 12 * 60, 3.139, 101.686);
  assert.ok(Math.abs(equinox.rawElevation - solstice.rawElevation) > 5);
  assert.ok(Math.abs(equinox.vector.z - solstice.vector.z) > 0.3);
});

test('sun vector follows +X east, +Y up, +Z north and clockwise-from-north azimuth', () => {
  const morning = sunPosition3d('2026-03-20', 9 * 60, 3.139, 101.686);
  const afternoon = sunPosition3d('2026-03-20', 15 * 60, 3.139, 101.686);
  for (const position of [morning, afternoon]) {
    const { x, y, z } = position.vector;
    closeTo(Math.hypot(x, y, z), 1, 1e-12, 'unit sun vector length');
    closeTo(Math.atan2(x, z) * 180 / Math.PI < 0
      ? Math.atan2(x, z) * 180 / Math.PI + 360
      : Math.atan2(x, z) * 180 / Math.PI, position.azimuth, 1e-10, 'azimuth from vector');
    closeTo(Math.asin(y) * 180 / Math.PI, position.rawElevation, 1e-10, 'elevation from vector');
  }
  assert.ok(morning.vector.x > 0, 'morning sun must be east (+X)');
  assert.ok(afternoon.vector.x < 0, 'afternoon sun must be west (-X)');
  assert.equal(sunGeometry(morning).x, 450 - morning.vector.x * 350);
  assert.equal(sunGeometry(morning).y, 205 - morning.vector.y * 142);
});

test('equation of time and longitude correction make local clock noon differ from solar noon', () => {
  const position = sunPosition3d('2026-02-11', 12 * 60, 3.139, 101.686);
  assert.notEqual(position.equationOfTimeMinutes, 0);
  assert.ok(position.solarTimeOffsetMinutes < -60);
  assert.ok(Math.abs(position.hourAngleDegrees) > 15);
});

test('horizon handling preserves a below-horizon vector and zeroes daylight output', () => {
  const night = sunPosition3d('2026-03-20', 0, 0, 120);
  const day = sunPosition3d('2026-03-20', 12 * 60, 0, 120);
  assert.ok(night.rawElevation < 0);
  assert.ok(night.vector.y < 0);
  assert.equal(night.elevation, 0);
  assert.equal(daylight('2026-03-20', 0, 0, 120), 0);
  assert.ok(day.rawElevation > 0);
  assert.ok(daylight('2026-03-20', 12 * 60, 0, 120) > 0);
  assert.equal(solarOutput('2026-03-20', 0, 100, 0, 0, 0, 120), 0);
});

test('daylight normalization peaks at solar transit rather than MYT clock noon', () => {
  const clockNoon = daylight('2026-03-20', 12 * 60, 3.139, 101.686);
  const solarTransit = daylight('2026-03-20', 13 * 60 + 21, 3.139, 101.686);
  assert.ok(clockNoon < 0.99, `MYT noon should precede local solar transit (${clockNoon})`);
  assert.ok(solarTransit > 0.99, `solar-transit daylight should peak (${solarTransit})`);
});

test('day/night transition uses consistent 0° threshold in both directions', () => {
  // Key elevation values specified in requirements: -0.2°, 0°, +0.2°, +1.5°
  assert.equal(isDay(-0.2), false, '-0.2° must evaluate to Night');
  assert.equal(isNight(-0.2), true, '-0.2° must evaluate to Night');

  assert.equal(isDay(0), false, '0° boundary must evaluate to Night');
  assert.equal(isNight(0), true, '0° boundary must evaluate to Night');

  assert.equal(isDay(0.2), true, '+0.2° must evaluate to Day');
  assert.equal(isNight(0.2), false, '+0.2° must evaluate to Day');

  assert.equal(isDay(1.5), true, '+1.5° must evaluate to Day');
  assert.equal(isNight(1.5), false, '+1.5° must evaluate to Day');

  // Transition from negative elevation to positive elevation (rising sun / morning)
  // Day begins when sun elevation crosses above 0°
  const risingElevations = [-0.2, 0, 0.2, 1.5];
  const risingStates = risingElevations.map(isDay);
  assert.deepEqual(risingStates, [false, false, true, true],
    'Rising: -0.2° and 0° are Night; +0.2° and +1.5° are Day');

  // Transition from positive elevation to negative elevation (setting sun / evening)
  // Night begins when sun elevation crosses below 0° (or reaches 0° boundary)
  const settingElevations = [1.5, 0.2, 0, -0.2];
  const settingStates = settingElevations.map(isDay);
  assert.deepEqual(settingStates, [true, true, false, false],
    'Setting: +1.5° and +0.2° are Day; 0° and -0.2° are Night');

  // Verify consistent 0° threshold in both directions without hysteresis
  const testAngles = [-5, -1.5, -0.2, -0.01, 0, 0.01, 0.2, 1.5, 5];
  for (const angle of testAngles) {
    const day = isDay(angle);
    const night = isNight(angle);
    assert.equal(day, !night, `isDay and isNight must be strictly complementary at ${angle}°`);
    assert.equal(day, angle > 0, `isDay must be true if and only if angle > 0 at ${angle}°`);
    assert.equal(night, angle <= 0, `isNight must be true if and only if angle <= 0 at ${angle}°`);
  }

  // Verify SunPosition object support matching sunPosition3d output
  assert.equal(isDay({ rawElevation: 0.2 }), true);
  assert.equal(isDay({ rawElevation: 0 }), false);
  assert.equal(isDay({ rawElevation: -0.2 }), false);
  assert.equal(isNight({ rawElevation: 0.2 }), false);
  assert.equal(isNight({ rawElevation: 0 }), true);
  assert.equal(isNight({ rawElevation: -0.2 }), true);
});
