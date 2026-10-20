import {
  CANOPY_ROOF_PIVOT_HEIGHT,
  CANOPY_ROOF_RADIUS,
  CANOPY_ROOF_UNDERSIDE_OFFSET,
  CANOPY_SEAT_RADIUS,
} from './park/canopyDimensions.ts';

export type Speed = 1 | 2 | 4;
export type HistoryPoint = { time: string; solar: number; demand: number; battery: number; temp: number; angle: number; fan: number };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (radiansValue: number) => radiansValue * 180 / Math.PI;

export const dayOfYear = (date: string) => {
  const value = new Date(`${date}T12:00:00`);
  const start = new Date(value.getFullYear(), 0, 0);
  return Math.floor((value.getTime() - start.getTime()) / 86_400_000);
};

/**
 * World convention: +X east, +Y up, +Z north. Azimuth is clockwise from north.
 * The local clock is treated as solar time, which keeps the existing time control
 * easy to read while latitude and date change the sun path.
 */
export const sunPosition3d = (hour: number, latitude = 3.139, day = 292, longitude = 101.686) => {
  const latitudeRad = radians(latitude);
  const declination = radians(23.44) * Math.sin(2 * Math.PI * (284 + day) / 365);
  const solarHour = hour + (longitude - 101.686) / 15;
  const hourAngle = radians((solarHour - 12) * 15);
  const x = -Math.cos(declination) * Math.sin(hourAngle);
  const y = Math.sin(latitudeRad) * Math.sin(declination) + Math.cos(latitudeRad) * Math.cos(declination) * Math.cos(hourAngle);
  const z = Math.cos(latitudeRad) * Math.sin(declination) - Math.sin(latitudeRad) * Math.cos(declination) * Math.cos(hourAngle);
  const rawElevation = degrees(Math.asin(y));
  const elevation = Math.max(0, rawElevation);
  const azimuth = (degrees(Math.atan2(x, z)) + 360) % 360;
  return { azimuth, elevation, rawElevation, vector: { x, y: Math.max(0, y), z } };
};

export const daylight = (hour: number, latitude = 3.139, day = 292, longitude = 101.686) => {
  const elevation = sunPosition3d(hour, latitude, day, longitude).elevation;
  const noonElevation = sunPosition3d(12, latitude, day, longitude).elevation;
  return clamp(Math.sin(radians(elevation)) / Math.max(.1, Math.sin(radians(noonElevation))), 0, 1);
};
export const sunGeometry = (hour: number) => {
  const phase = (hour - 6) / 12 * Math.PI;
  return { x: 76 + 430 * (hour / 24), y: 205 - Math.max(0, Math.sin(phase)) * 142 };
};
export const automaticAngle = (hour: number, temp: number) => clamp(Math.sin((hour - 12) / 12 * Math.PI) * 10 + (temp > 32 ? 3 : 0), -15, 15);
export const roofOrientationFactor = (hour: number, tilt: number, heading: number, latitude = 3.139, day = 292, longitude = 101.686) => {
  const sun = sunPosition3d(hour, latitude, day, longitude).vector, t = radians(tilt), h = radians(heading);
  const normal = { x: Math.sin(h) * Math.sin(t), y: Math.cos(t), z: Math.cos(h) * Math.sin(t) };
  return clamp(.82 + .18 * Math.max(0, normal.x * sun.x + normal.y * sun.y + normal.z * sun.z), .55, 1);
};
export const shadeCoverage = (hour: number, angle: number, heading = 0, latitude = 3.139, day = 292, longitude = 101.686) => {
  const position = sunPosition3d(hour, latitude, day, longitude);
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
  for (let person = 0; person < 8; person++) {
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
  return Math.round((shaded / total) * 100);
};
export const solarOutput = (hour: number, sunlight: number, tilt: number, heading = 0, latitude = 3.139, day = 292, longitude = 101.686) => clamp(18 * daylight(hour, latitude, day, longitude) * sunlight / 100 * roofOrientationFactor(hour, tilt, heading, latitude, day, longitude), 0, 18);
