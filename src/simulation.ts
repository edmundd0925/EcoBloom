import * as THREE from 'three';
import {
  OCCUPIED_AREA_CENTER_X,
  OCCUPIED_AREA_CENTER_Z,
  OCCUPIED_AREA_RADIUS,
  CANOPY_ROOF_PIVOT_HEIGHT,
  CANOPY_ROOF_RADIUS,
  CANOPY_ROOF_UNDERSIDE_OFFSET,
  CANOPY_SEAT_RADIUS,
  CANOPY_TILT_LIMITS,
  SHADE_SAMPLE_SPACING,
} from './park/canopyDimensions.ts';
import { calculateGroundAreaShade, type GroundShadeResult } from './park/groundShadeCoverage.ts';
import { createOpaqueRoofSurfaces, OPAQUE_ROOF_SHADE_GEOMETRY_VERSION } from './park/createEcoCanopyModel.ts';

export type Speed = 1 | 2 | 4;
export type HistoryPoint = { time: string; solar: number; demand: number; battery: number; temp: number; angle: number; fan: number };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (radiansValue: number) => radiansValue * 180 / Math.PI;
export const MYT_UTC_OFFSET_HOURS = 8;
export const MYT_STANDARD_MERIDIAN = 15 * MYT_UTC_OFFSET_HOURS;

function parseCalendarDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError('Date must use YYYY-MM-DD format.');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const value = new Date(0);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCFullYear(year, month - 1, day);
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) {
    throw new RangeError('Date must be a valid calendar date.');
  }
  return value;
}

/** Converts the selected Malaysian civil date and fractional minute to its UTC instant. */
export function mytToUtc(date: string, minute: number) {
  if (!Number.isFinite(minute) || minute < 0 || minute >= 1440) {
    throw new RangeError('MYT minute must be between 0 and 1439.999...');
  }
  return new Date(parseCalendarDate(date).getTime() + minute * 60_000 - MYT_UTC_OFFSET_HOURS * 3_600_000);
}

export const dayOfYear = (date: string) => {
  const value = parseCalendarDate(date);
  const start = new Date(0);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCFullYear(value.getUTCFullYear(), 0, 1);
  return Math.floor((value.getTime() - start.getTime()) / 86_400_000) + 1;
};

/**
 * World convention: +X east, +Y up, +Z north. Azimuth is clockwise from north.
 * The selected date and minute are Malaysian local civil time (MYT, UTC+8).
 * This is the NOAA fractional-year equation-of-time/declination method, using
 * the UTC instant for the fractional year and MYT's 120-degree standard meridian.
 */
export const sunPosition3d = (date: string, minute: number, latitude = 3.139, longitude = 101.686) => {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new RangeError('Latitude must be between -90 and 90 degrees.');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new RangeError('Longitude must be between -180 and 180 degrees.');

  const utc = mytToUtc(date, minute);
  const year = utc.getUTCFullYear();
  const utcDay = dayOfYear(`${year}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`);
  const daysInYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
  const utcMinute = utc.getUTCHours() * 60 + utc.getUTCMinutes() + utc.getUTCSeconds() / 60 + utc.getUTCMilliseconds() / 60_000;
  const utcHour = utcMinute / 60;
  const gamma = 2 * Math.PI / daysInYear * (utcDay - 1 + (utcHour - 12) / 24);
  const equationOfTimeMinutes = 229.18 * (
    0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)
  );
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const solarTimeOffsetMinutes = equationOfTimeMinutes + 4 * (longitude - MYT_STANDARD_MERIDIAN);
  const hourAngleDegrees = (minute + solarTimeOffsetMinutes) / 4 - 180;
  const latitudeRad = radians(latitude);
  const declinationRad = declination;
  const hourAngle = radians(hourAngleDegrees);
  const x = -Math.cos(declinationRad) * Math.sin(hourAngle);
  const y = Math.sin(latitudeRad) * Math.sin(declinationRad) + Math.cos(latitudeRad) * Math.cos(declinationRad) * Math.cos(hourAngle);
  const z = Math.cos(latitudeRad) * Math.sin(declinationRad) - Math.sin(latitudeRad) * Math.cos(declinationRad) * Math.cos(hourAngle);
  const rawElevation = degrees(Math.asin(clamp(y, -1, 1)));
  const elevation = Math.max(0, rawElevation);
  const azimuth = (degrees(Math.atan2(x, z)) + 360) % 360;
  return {
    azimuth, elevation, rawElevation, vector: { x, y, z },
    declinationDegrees: degrees(declinationRad),
    equationOfTimeMinutes, solarTimeOffsetMinutes, hourAngleDegrees,
    utcDateTime: utc.toISOString(),
  };
};
export type SunPosition = ReturnType<typeof sunPosition3d>;

export type GroundShadeCacheInputs = {
  date: string;
  minute: number;
  latitude: number;
  longitude: number;
  angle: number;
  heading: number;
};

/**
 * Stable identity for every input that can change the exact area estimate.
 * Geometry and solar-model values are included so configuration changes cannot
 * silently reuse a result computed for a different model.
 */
export const groundShadeCoverageCacheKey = ({ date, minute, latitude, longitude, angle, heading }: GroundShadeCacheInputs) => JSON.stringify({
  inputs: [date, minute, latitude, longitude, angle, heading],
  model: {
    solarPositionVersion: 1,
    groundShadeMethodVersion: 1,
    mytUtcOffsetHours: MYT_UTC_OFFSET_HOURS,
    mytStandardMeridian: MYT_STANDARD_MERIDIAN,
    occupiedArea: [OCCUPIED_AREA_RADIUS, OCCUPIED_AREA_CENTER_X, OCCUPIED_AREA_CENTER_Z],
    sampleSpacing: SHADE_SAMPLE_SPACING,
    roofGeometry: [CANOPY_ROOF_RADIUS, CANOPY_ROOF_PIVOT_HEIGHT, CANOPY_ROOF_UNDERSIDE_OFFSET],
    opaqueRoofGeometryVersion: OPAQUE_ROOF_SHADE_GEOMETRY_VERSION,
  },
});

/** One-entry result cache for the expensive exact ground-area raycast. */
export function createGroundShadeResultCache() {
  let cachedKey: string | undefined;
  let cachedResult: GroundShadeResult | undefined;
  return {
    getOrCalculate(key: string, calculate: () => GroundShadeResult): GroundShadeResult {
      if (key === cachedKey && cachedResult) return cachedResult;
      cachedResult = calculate();
      cachedKey = key;
      return cachedResult;
    },
    clear() {
      cachedKey = undefined;
      cachedResult = undefined;
    },
  };
}

export const daylight = (date: string, minute: number, latitude = 3.139, longitude = 101.686) => {
  const sun = sunPosition3d(date, minute, latitude, longitude);
  const noonElevation = Math.max(0, 90 - Math.abs(latitude - sun.declinationDegrees));
  const elevation = sun.elevation;
  return clamp(Math.sin(radians(elevation)) / Math.max(.1, Math.sin(radians(noonElevation))), 0, 1);
};
export const sunGeometry = (sun: SunPosition) => ({
  x: 450 - sun.vector.x * 350,
  y: 205 - Math.max(0, sun.vector.y) * 142,
});
export const automaticAngle = (hour: number, temp: number) => clamp(
  Math.sin((hour - 12) / 12 * Math.PI) * 10 + (temp > 32 ? 3 : 0),
  CANOPY_TILT_LIMITS.min,
  CANOPY_TILT_LIMITS.max,
);
export const roofOrientationFactor = (date: string, minute: number, tilt: number, heading: number, latitude = 3.139, longitude = 101.686) => {
  const sun = sunPosition3d(date, minute, latitude, longitude).vector, t = radians(tilt), h = radians(heading);
  const normal = { x: Math.sin(h) * Math.sin(t), y: Math.cos(t), z: Math.cos(h) * Math.sin(t) };
  return clamp(.82 + .18 * Math.max(0, normal.x * sun.x + normal.y * sun.y + normal.z * sun.z), .55, 1);
};

// This shadow-only rig uses the same roof meshes and pivot transforms as the
// rendered canopy, while its materials are double-sided for underside ray hits.
const shadeYaw = new THREE.Group();
shadeYaw.position.y = CANOPY_ROOF_PIVOT_HEIGHT;
const shadeTilt = new THREE.Group();
shadeYaw.add(shadeTilt);
const shadeRoof = createOpaqueRoofSurfaces(true);
shadeTilt.add(shadeRoof.group);

export const groundAreaShadeCoverage = (
  sun: SunPosition,
  angle: number,
  heading = 0,
  sampleSpacing = SHADE_SAMPLE_SPACING,
): GroundShadeResult => {
  shadeYaw.rotation.y = radians(heading);
  shadeTilt.rotation.x = radians(angle);
  shadeYaw.updateMatrixWorld(true);
  const direction = sun.rawElevation > 0
    ? new THREE.Vector3(sun.vector.x, sun.vector.y, sun.vector.z)
    : new THREE.Vector3();
  return calculateGroundAreaShade(shadeRoof.meshes, direction, {
    radius: OCCUPIED_AREA_RADIUS,
    sampleSpacing,
    centerX: OCCUPIED_AREA_CENTER_X,
    centerZ: OCCUPIED_AREA_CENTER_Z,
  });
};

/**
 * Secondary legacy person-sample estimate. The dashboard retains its original
 * eight-person default; the original park app may pass its selected occupancy.
 */
export const shadeCoverage = (date: string, minute: number, angle: number, heading = 0, latitude = 3.139, longitude = 101.686, occupancy = 8) => {
  const position = sunPosition3d(date, minute, latitude, longitude);
  const sun = position.vector;
  if (sun.y <= 0) return 0;

  const tilt = radians(angle), yaw = radians(heading);
  const roofNormal = {
    x: Math.sin(yaw) * Math.sin(tilt),
    y: Math.cos(tilt),
    z: Math.cos(yaw) * Math.sin(tilt),
  };
  const roofCenter = {
    x: Math.sin(yaw) * Math.sin(tilt) * CANOPY_ROOF_UNDERSIDE_OFFSET,
    y: CANOPY_ROOF_PIVOT_HEIGHT + Math.cos(tilt) * CANOPY_ROOF_UNDERSIDE_OFFSET,
    z: Math.cos(yaw) * Math.sin(tilt) * CANOPY_ROOF_UNDERSIDE_OFFSET,
  };
  const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;
  const roofRayDenominator = dot(sun, roofNormal);
  const isRoofShaded = (point: { x: number; y: number; z: number }) => {
    if (roofRayDenominator <= 0) return false;
    const distance = dot({ x: roofCenter.x - point.x, y: roofCenter.y - point.y, z: roofCenter.z - point.z }, roofNormal) / roofRayDenominator;
    if (distance <= 0) return false;
    const hit = { x: point.x + sun.x * distance, y: point.y + sun.y * distance, z: point.z + sun.z * distance };
    const dx = hit.x - roofCenter.x, dy = hit.y - roofCenter.y, dz = hit.z - roofCenter.z;
    return dx * dx + dy * dy + dz * dz <= CANOPY_ROOF_RADIUS * CANOPY_ROOF_RADIUS;
  };
  // Sample each seated person at body/head height and across the torso footprint.
  let shaded = 0, total = 0;
  for (let person = 0; person < Math.min(8, Math.max(0, Math.floor(occupancy))); person++) {
    const a = (person / 8) * Math.PI * 2;
    const centerX = Math.sin(a) * CANOPY_SEAT_RADIUS;
    const centerZ = Math.cos(a) * CANOPY_SEAT_RADIUS;
    const offsets = [[0, 0], [.11, 0], [-.11, 0], [0, .11], [0, -.11]] as const;
    for (const y of [.55, .8, 1.05]) {
      for (const [offsetX, offsetZ] of offsets) {
        const point = { x: centerX + offsetX, y, z: centerZ + offsetZ };
        if (isRoofShaded(point)) shaded++;
        total++;
      }
    }
  }
  return total === 0 ? 0 : Math.round((shaded / total) * 100);
};
export const solarOutput = (date: string, minute: number, sunlight: number, tilt: number, heading = 0, latitude = 3.139, longitude = 101.686) => clamp(18 * daylight(date, minute, latitude, longitude) * sunlight / 100 * roofOrientationFactor(date, minute, tilt, heading, latitude, longitude), 0, 18);
