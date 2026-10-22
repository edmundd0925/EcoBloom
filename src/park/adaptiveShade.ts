import type { RoofPosition } from './shadeOptimization.ts';

export const ADAPTIVE_SHADE_TRIGGER_ANGLE_DEGREES = 3;
export const ADAPTIVE_SHADE_MINIMUM_IMPROVEMENT_PERCENT = 1;

export type SunDirection = { x: number; y: number; z: number };
export type AdaptiveControlMode = 'adaptive' | 'manual';
export type AdaptiveSearchSchedule = 'none' | 'start' | 'queue';
export type ManualTimeSearchAction = 'none' | 'defer' | 'search';

/** Defer repeated slider input until release, then force a daylight search. */
export function manualTimeChangeSearchAction(adaptiveEnabled: boolean, timeInteractionActive: boolean): ManualTimeSearchAction {
  if (!adaptiveEnabled) return 'none';
  return timeInteractionActive ? 'defer' : 'search';
}

/** Identifies the exact environmental snapshot used by one adaptive search. */
export function adaptiveShadeInputKey(date: string, minute: number, latitude: number, longitude: number) {
  return JSON.stringify([date, minute, latitude, longitude]);
}

/** Rejects results from a cancelled run, older environmental snapshot, or excessive sun drift. */
export function isAdaptiveShadeSearchCurrent(
  runId: number,
  activeRunId: number,
  searchInputKey: string,
  currentInputKey: string,
  adaptiveEnabled: boolean,
  options: {
    allowClockDrift?: boolean;
    sameContext?: boolean;
    directSunAvailable?: boolean;
    searchSun?: SunDirection;
    currentSun?: SunDirection;
    maxDriftDegrees?: number;
  } = {},
) {
  if (!adaptiveEnabled || runId !== activeRunId || options.directSunAvailable === false) return false;
  if (searchInputKey === currentInputKey) return true;
  if (!options.allowClockDrift || !options.sameContext) return false;
  if (options.searchSun && options.currentSun && options.maxDriftDegrees !== undefined) {
    return vectorAngleDegrees(options.searchSun, options.currentSun) < options.maxDriftDegrees;
  }
  return true;
}

/** Small LRU cache for exact shade scores of individual roof-pose candidates. */
export function createAdaptiveShadeSearchCache<T>(maxEntries = 3) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('Search-cache size must be a positive integer.');
  const entries = new Map<string, T>();
  return {
    get(key: string): T | undefined {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key)!;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key: string, value: T) {
      entries.delete(key);
      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value!);
      entries.set(key, value);
    },
    clear() { entries.clear(); },
  };
}

export const vectorAngleDegrees = (first: SunDirection, second: SunDirection) => {
  const firstLength = Math.hypot(first.x, first.y, first.z);
  const secondLength = Math.hypot(second.x, second.y, second.z);
  if (firstLength === 0 || secondLength === 0) return 180;
  const cosine = (first.x * second.x + first.y * second.y + first.z * second.z)
    / (firstLength * secondLength);
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
};

/** Search once on adaptive entry, then only after a meaningful sun-vector change. */
export function shouldSearchAdaptiveShade(
  adaptiveEnabled: boolean,
  directSunAvailable: boolean,
  currentSun: SunDirection,
  lastSearchedSun: SunDirection | null,
  thresholdDegrees = ADAPTIVE_SHADE_TRIGGER_ANGLE_DEGREES,
) {
  if (!adaptiveEnabled || !directSunAvailable) return false;
  if (!lastSearchedSun) return true;
  return vectorAngleDegrees(lastSearchedSun, currentSun) >= thresholdDegrees;
}

/** Coalesce meaningful sun changes while one worker search is already running. */
export function scheduleAdaptiveShadeSearch(
  adaptiveEnabled: boolean,
  directSunAvailable: boolean,
  currentSun: SunDirection,
  lastSearchedSun: SunDirection | null,
  searchRunning: boolean,
  thresholdDegrees = ADAPTIVE_SHADE_TRIGGER_ANGLE_DEGREES,
): AdaptiveSearchSchedule {
  if (!shouldSearchAdaptiveShade(adaptiveEnabled, directSunAvailable, currentSun, lastSearchedSun, thresholdDegrees)) return 'none';
  return searchRunning ? 'queue' : 'start';
}

/** Center the roof at night only in adaptive mode; manual poses remain user-owned. */
export function adaptiveTargetForSun(
  adaptiveEnabled: boolean,
  directSunAvailable: boolean,
  currentTarget: RoofPosition,
): RoofPosition {
  return adaptiveEnabled && !directSunAvailable
    ? { heading: 0, tilt: 0 }
    : currentTarget;
}

/**
 * Fast, reasonable initial estimate for canopy pose that responds immediately to sun
 * position to cast ground shade over the occupied area, prior to exact optimizer refinement.
 * Preserves the ground-shade coverage objective and respects provisional movement limits
 * (heading in [-90, 90], tilt in [-30, 30]).
 */
export function initialShadePoseEstimate(
  directSunAvailable: boolean,
  sunVector: SunDirection,
  elevationDegrees: number,
): RoofPosition {
  if (!directSunAvailable || elevationDegrees <= 0) {
    return { heading: 0, tilt: 0 };
  }
  const { x, z } = sunVector;
  const el = Math.max(0, elevationDegrees);
  const maxTilt = 30;
  // Tilt magnitude scales with sun angle from overhead (90° -> 0° tilt, lower sun -> steeper tilt up to 30°)
  const tiltMag = Math.min(maxTilt, Math.max(0, (90 - el) * (maxTilt / 60)));

  // When sun is in East (x >= 0), negative tilt shifts the roof to cast shade over the center.
  // When sun is in West (x < 0), positive tilt shifts the roof to cast shade over the center.
  let h = -90;
  const t = x >= 0 ? -tiltMag : tiltMag;
  if (Math.abs(z) > 0.04) {
    h = Math.max(-90, Math.min(90, -90 + (x >= 0 ? z * 20 : -z * 20)));
  }

  return {
    heading: Math.max(-90, Math.min(90, Math.round(h * 10) / 10)),
    tilt: Math.max(-30, Math.min(30, Math.round(t * 10) / 10)),
  };
}

/**
 * Computes the target canopy pose from the continuous initial estimate and the
 * optimizer's refinement offset, constrained by provisional geometry limits.
 */
export function calculateAdaptiveTargetPose(
  fastPose: RoofPosition,
  refinement: { heading: number; tilt: number } | null,
  directSunAvailable: boolean,
): RoofPosition {
  if (!directSunAvailable) {
    return { heading: 0, tilt: 0 };
  }
  const hOffset = refinement?.heading ?? 0;
  const tOffset = refinement?.tilt ?? 0;
  return {
    heading: Math.max(-90, Math.min(90, Math.round((fastPose.heading + hOffset) * 10) / 10)),
    tilt: Math.max(-30, Math.min(30, Math.round((fastPose.tilt + tOffset) * 10) / 10)),
  };
}

/** Preserve the current target when switching modes so the roof does not jump. */
export function transitionAdaptiveControlMode(
  currentMode: AdaptiveControlMode,
  currentTarget: RoofPosition,
) {
  return {
    mode: currentMode === 'adaptive' ? 'manual' as const : 'adaptive' as const,
    pose: { heading: currentTarget.heading, tilt: currentTarget.tilt },
  };
}
