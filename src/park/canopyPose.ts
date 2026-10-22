import * as THREE from 'three';
import type { CanopyModel } from './createEcoCanopyModel';

export type CanopyPoseRadians = { yaw: number; tilt: number };

/**
 * Normalizes an angle in radians to the range (-PI, PI].
 */
export function normalizeAngleRad(angleRad: number): number {
  return Math.atan2(Math.sin(angleRad), Math.cos(angleRad));
}

/**
 * Normalizes an angle in degrees to the range (-180, 180].
 */
export function normalizeAngleDeg(angleDeg: number): number {
  let d = angleDeg % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

/**
 * Computes the shortest angular difference (target - current) in radians,
 * normalized to the range [-PI, PI].
 */
export function shortestAngleDifferenceRad(targetRad: number, currentRad: number): number {
  return Math.atan2(Math.sin(targetRad - currentRad), Math.cos(targetRad - currentRad));
}

/**
 * Computes the shortest angular difference (target - current) in degrees,
 * normalized to the range [-180, 180].
 */
export function shortestAngleDifferenceDeg(targetDeg: number, currentDeg: number): number {
  let diff = (targetDeg - currentDeg) % 360;
  if (diff > 180) diff -= 360;
  else if (diff <= -180) diff += 360;
  return diff;
}

/**
 * Apply one eased target pose to the same pivots used by the rendered canopy.
 * Uses shortest-angle interpolation for heading to avoid full-circle spins across
 * wraparound boundaries (e.g. 350° -> 10° rotates 20°, not 340°).
 * Tilt is an elevation angle and is damped directly without angular wrapping.
 */
export function dampCanopyPose(
  canopy: Pick<CanopyModel, 'roofYaw' | 'roofTilt'>,
  current: CanopyPoseRadians,
  targetDegrees: { heading: number; tilt: number },
  deltaSeconds: number,
): CanopyPoseRadians {
  const targetYawRad = THREE.MathUtils.degToRad(targetDegrees.heading);
  // Calculate shortest angular difference normalized to [-PI, PI]
  const diffYaw = shortestAngleDifferenceRad(targetYawRad, current.yaw);
  // Damp toward (current.yaw + diffYaw) along the shortest arc
  let yaw = THREE.MathUtils.damp(current.yaw, current.yaw + diffYaw, 4, deltaSeconds);
  // Normalize yaw to (-PI, PI] to prevent unbounded accumulation
  yaw = normalizeAngleRad(yaw);

  // Tilt is an elevation angle, damped directly without wrapping
  const targetTiltRad = THREE.MathUtils.degToRad(targetDegrees.tilt);
  const tilt = THREE.MathUtils.damp(current.tilt, targetTiltRad, 4, deltaSeconds);

  canopy.roofYaw.rotation.y = yaw;
  canopy.roofTilt.rotation.x = tilt;
  return { yaw, tilt };
}
