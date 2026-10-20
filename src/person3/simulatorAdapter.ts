/**
 * Temporary demo adapter for the Person 3 dashboard.
 * Person 2 can replace the roof decision function, and Person 4 can replace
 * the energy calculations without changing the React interface.
 * Reuses the team's existing geometry / illustrative solar functions.
 */
import {
  automaticAngle,
  dayOfYear,
  daylight,
  shadeCoverage,
  solarOutput,
  sunPosition3d,
} from '../simulation';

export type OperatingMode = 'AUTO' | 'MANUAL' | 'OFF';
export type FanMode = 'AUTO' | 'ON' | 'OFF';
export type PlaybackSpeed = 1 | 2 | 4;

export interface DashboardInputs {
  date: string;
  minute: number;
  latitude: number;
  longitude: number;
  temperature: number; // Celsius
  windSpeed: number; // m/s
  sunlight: number; // percent
  occupancy: number; // people (0-8)
  battery: number; // percent
  mode: OperatingMode;
  manualHeading: number; // degrees
  manualTilt: number; // degrees
  fanMode: FanMode;
}

export interface DashboardOutputs {
  heading: number;
  tilt: number;
  shade: number;
  solarKw: number;
  demandKw: number;
  battery: number;
  sunAzimuth: number;
  sunElevation: number;
  sunAltitude: number;
  fansOn: boolean;
  lightsOn: boolean;
  night: boolean;
  windAlert: boolean;
  energyState: 'Charging' | 'Discharging' | 'Balanced';
  operatingState: string;
  reason: string;
}

export interface EnergyPoint {
  time: string;
  solar: number;
  demand: number;
  battery?: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export const formatTime = (minute: number) =>
  `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

export const defaultInputs = (): DashboardInputs => ({
  date: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10),
  minute: 14 * 60,
  latitude: 3.139,
  longitude: 101.686,
  temperature: 34,
  windSpeed: 4,
  sunlight: 82,
  occupancy: 4,
  battery: 76,
  mode: 'AUTO',
  manualHeading: 0,
  manualTilt: 0,
  fanMode: 'AUTO',
});

// The wind threshold and power values are DEMO assumptions, not engineering validation.
export const DEMO_WIND_LIMIT_MS = 12;
export const DEMO_BATTERY_CAPACITY_KWH = 48;

/** All values are illustrative until validated by Persons 2 and 4. */
export function calculateDemoOutput(input: DashboardInputs): DashboardOutputs {
  const hour = input.minute / 60;
  const day = dayOfYear(input.date);
  const sun = sunPosition3d(hour, input.latitude, day, input.longitude);
  const night = daylight(hour, input.latitude, day, input.longitude) < 0.03;
  const windAlert = input.windSpeed >= DEMO_WIND_LIMIT_MS;
  const energySaving = input.battery <= 8;

  let heading = 0;
  let tilt = 0;
  let reason = 'System is in standby; roof motion is disabled.';
  let operatingState = 'STANDBY';

  if (windAlert) {
    operatingState = 'WIND SAFETY';
    reason = `Wind speed ${input.windSpeed.toFixed(1)} m/s exceeds the ${DEMO_WIND_LIMIT_MS} m/s demonstration threshold. Roof is sent to a neutral position.`;
  } else if (input.mode === 'OFF') {
    operatingState = 'STANDBY';
  } else if (energySaving) {
    operatingState = 'POWER SAVE';
    reason = 'Battery is low. Roof returns to neutral to conserve remaining power.';
  } else if (input.mode === 'MANUAL') {
    heading = clamp(input.manualHeading, -90, 90);
    tilt = clamp(input.manualTilt, -15, 15);
    operatingState = 'MANUAL';
    reason = 'Operator-selected rotation and tilt angles are applied.';
  } else if (night) {
    operatingState = 'NIGHT';
    reason = 'After sunset, automatic tracking returns to the neutral roof position.';
  } else {
    heading = clamp(180 - sun.azimuth, -55, 55);
    tilt = automaticAngle(hour, input.temperature);
    operatingState = 'AUTO TRACKING';
    reason = `Roof follows the simulated sun position (${sun.azimuth.toFixed(0)}° azimuth, ${sun.elevation.toFixed(0)}° elevation) to improve seating shade.`;
  }

  const shade = night ? 0 : shadeCoverage(hour, tilt, heading, input.latitude, day, input.longitude);
  const solarKw = input.mode === 'OFF' || windAlert
    ? solarOutput(hour, input.sunlight, 0, 0, input.latitude, day, input.longitude)
    : solarOutput(hour, input.sunlight, tilt, heading, input.latitude, day, input.longitude);
  const fansOn = !windAlert && input.mode !== 'OFF' && input.occupancy > 0 && input.battery > 7 &&
    (input.fanMode === 'ON' || (input.fanMode === 'AUTO' && input.temperature >= 30));
  const lightsOn = !windAlert && input.mode !== 'OFF' && night && input.occupancy > 0 && input.battery > 5;
  const demandKw = 0.18 + (fansOn ? 0.56 : 0) + (lightsOn ? 0.24 : 0);
  const net = solarKw - demandKw;
  const energyState = net > 0.1 ? 'Charging' : net < -0.1 ? 'Discharging' : 'Balanced';

  return {
    heading, tilt, shade, solarKw, demandKw, battery: input.battery,
    sunAzimuth: sun.azimuth, sunElevation: sun.elevation, sunAltitude: sun.rawElevation,
    fansOn, lightsOn, night, windAlert, energyState, operatingState, reason,
  };
}

/** A forecast-style chart that reacts to controls. Not historical measurements. */
export function makeDayProfile(input: DashboardInputs): EnergyPoint[] {
  const points: EnergyPoint[] = [];
  for (let minute = 0; minute < 1440; minute += 60) {
    const sample = calculateDemoOutput({ ...input, minute });
    points.push({ time: formatTime(minute), solar: +sample.solarKw.toFixed(2), demand: +sample.demandKw.toFixed(2) });
  }
  return points;
}

/** Advances demo battery energy by actual simulated minutes, not by slider scrubbing. */
export function advanceBattery(percent: number, solarKw: number, demandKw: number, simulatedMinutes: number) {
  const netKwh = (solarKw - demandKw) * simulatedMinutes / 60;
  return clamp(percent + (netKwh / DEMO_BATTERY_CAPACITY_KWH) * 100 * (netKwh >= 0 ? 0.92 : 1.08), 0, 100);
}
