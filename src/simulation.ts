export type Speed = 1 | 2 | 4;
export type HistoryPoint = { time: string; solar: number; demand: number; battery: number; temp: number; angle: number; fan: number };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const daylight = (hour: number) => clamp(Math.sin(Math.PI * (hour - 6) / 12), 0, 1);
export const sunGeometry = (hour: number) => {
  const phase = (hour - 6) / 12 * Math.PI;
  return { x: 76 + 430 * (hour / 24), y: 205 - Math.max(0, Math.sin(phase)) * 142 };
};
export const automaticAngle = (hour: number, temp: number) => clamp(Math.sin((hour - 12) / 12 * Math.PI) * 10 + (temp > 32 ? 3 : 0), -15, 15);
export const shadeCoverage = (hour: number, angle: number) => {
  const sun = daylight(hour);
  const projected = Math.abs(Math.sin((hour - 12) / 12 * Math.PI)) * 0.24;
  return Math.round(clamp(84 - projected * 100 + Math.abs(angle) * 0.55 + sun * 6, 35, 98));
};
export const solarOutput = (hour: number, sunlight: number, angle: number) => clamp(18 * daylight(hour) * sunlight / 100 * (0.94 + 0.06 * Math.cos(angle * Math.PI / 180)), 0, 18);
// The model is illustrative: daylight follows a 06:00–18:00 sine curve and canopy dimensions are normalized to the seating zone.
