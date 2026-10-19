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
  const elevation = Math.max(0, degrees(Math.asin(y)));
  const azimuth = (degrees(Math.atan2(x, z)) + 360) % 360;
  return { azimuth, elevation, vector: { x, y: Math.max(0, y), z } };
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
const circleOverlapArea = (firstRadius: number, secondRadius: number, distance: number) => {
  if (distance >= firstRadius + secondRadius) return 0;
  if (distance <= Math.abs(firstRadius - secondRadius)) return Math.PI * Math.min(firstRadius, secondRadius) ** 2;
  const first = Math.acos(clamp((distance ** 2 + firstRadius ** 2 - secondRadius ** 2) / (2 * distance * firstRadius), -1, 1));
  const second = Math.acos(clamp((distance ** 2 + secondRadius ** 2 - firstRadius ** 2) / (2 * distance * secondRadius), -1, 1));
  const chord = .5 * Math.sqrt((-distance + firstRadius + secondRadius) * (distance + firstRadius - secondRadius) * (distance - firstRadius + secondRadius) * (distance + firstRadius + secondRadius));
  return firstRadius ** 2 * first + secondRadius ** 2 * second - chord;
};
export const shadeCoverage = (hour: number, angle: number, heading = 0, latitude = 3.139, day = 292, longitude = 101.686) => {
  const sun = sunPosition3d(hour, latitude, day, longitude).vector;
  if (sun.y <= 0) return 0;
  const horizontalLength = Math.hypot(sun.x, sun.z);
  const shadowOffset = 1.5 * horizontalLength / Math.max(.08, sun.y);
  const tiltFactor = .92 + .08 * Math.cos(radians(angle));
  const headingFactor = .96 + .04 * Math.abs(Math.cos(radians(heading)));
  const shadowRadius = 2 * tiltFactor * headingFactor;
  const seatRadius = 1.25;
  return Math.round(clamp(circleOverlapArea(shadowRadius, seatRadius, shadowOffset) / (Math.PI * seatRadius ** 2) * 100, 0, 100));
};
export const solarOutput = (hour: number, sunlight: number, tilt: number, heading = 0, latitude = 3.139, day = 292, longitude = 101.686) => clamp(18 * daylight(hour, latitude, day, longitude) * sunlight / 100 * roofOrientationFactor(hour, tilt, heading, latitude, day, longitude), 0, 18);
