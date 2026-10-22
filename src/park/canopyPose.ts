import * as THREE from 'three';
import type { CanopyModel } from './createEcoCanopyModel';

export type CanopyPoseRadians = { yaw: number; tilt: number };

/** Apply one eased target pose to the same pivots used by the rendered canopy. */
export function dampCanopyPose(
  canopy: Pick<CanopyModel, 'roofYaw' | 'roofTilt'>,
  current: CanopyPoseRadians,
  targetDegrees: { heading: number; tilt: number },
  deltaSeconds: number,
): CanopyPoseRadians {
  const yaw = THREE.MathUtils.damp(current.yaw, THREE.MathUtils.degToRad(targetDegrees.heading), 4, deltaSeconds);
  const tilt = THREE.MathUtils.damp(current.tilt, THREE.MathUtils.degToRad(targetDegrees.tilt), 4, deltaSeconds);
  canopy.roofYaw.rotation.y = yaw;
  canopy.roofTilt.rotation.x = tilt;
  return { yaw, tilt };
}
