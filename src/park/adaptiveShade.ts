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

/** Rejects results from a cancelled run or from an older environmental snapshot. */
export function isAdaptiveShadeSearchCurrent(
  runId: number,
  activeRunId: number,
  searchInputKey: string,
  currentInputKey: string,
  adaptiveEnabled: boolean,
  options: { allowClockDrift?: boolean; sameContext?: boolean; directSunAvailable?: boolean } = {},
) {
  if (!adaptiveEnabled || runId !== activeRunId || options.directSunAvailable === false) return false;
  return searchInputKey === currentInputKey || Boolean(options.allowClockDrift && options.sameContext);
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

const vectorAngleDegrees = (first: SunDirection, second: SunDirection) => {
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
