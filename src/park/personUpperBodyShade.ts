import * as THREE from 'three';
import { CANOPY_SEAT_RADIUS } from './canopyDimensions.ts';

export type PersonRegion = 'head' | 'neck' | 'shoulders' | 'torso';

export type PersonUpperBodySample = {
  region: PersonRegion;
  point: THREE.Vector3;
};

export type PersonShadeBreakdown = {
  personIndex: number;
  totalSamples: number;
  shadedSamples: number;
  coveragePercent: number;
  regions: {
    head: { total: number; shaded: number };
    neck: { total: number; shaded: number };
    shoulders: { total: number; shaded: number };
    torso: { total: number; shaded: number };
  };
};

export type PersonUpperBodyShadeResult = {
  /** Aggregated upper-body shade coverage percentage (0 - 100) across seated visitors. */
  coveragePercent: number;
  /** False when sun is on or below the horizon; indicates direct sun unavailable. */
  directSunAvailable: boolean;
  /** Number of seated people evaluated (respects occupancy). */
  occupancy: number;
  /** Count of shaded upper-body sample points. */
  shadedSamples: number;
  /** Total upper-body sample points across active seated visitors. */
  totalSamples: number;
  /** Detailed per-person shade breakdown. */
  people: PersonShadeBreakdown[];
};

/**
 * Local upper-body offsets (right, forward, height) relative to each seated person.
 * Excludes lower legs (y < 0.50) and ground (y = 0).
 */
const UPPER_BODY_OFFSETS: Array<{ region: PersonRegion; r: number; f: number; y: number }> = [
  // Head: crown / top and face / forehead
  { region: 'head', r: 0, f: 0.04, y: 1.06 },
  { region: 'head', r: 0, f: 0.08, y: 1.00 },
  // Neck
  { region: 'neck', r: 0, f: 0.04, y: 0.90 },
  // Shoulders: left and right
  { region: 'shoulders', r: -0.16, f: 0.02, y: 0.82 },
  { region: 'shoulders', r: 0.16, f: 0.02, y: 0.82 },
  // Torso: upper chest, mid torso, left torso, right torso
  { region: 'torso', r: 0, f: 0.04, y: 0.72 },
  { region: 'torso', r: -0.12, f: 0.02, y: 0.64 },
  { region: 'torso', r: 0.12, f: 0.02, y: 0.64 },
  { region: 'torso', r: 0, f: 0.03, y: 0.58 },
];

/**
 * Precomputed 3D world positions of upper-body sample points for each of the 8 seated positions.
 */
export const PERSON_UPPER_BODY_SAMPLES: PersonUpperBodySample[][] = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  const seatX = Math.sin(a) * CANOPY_SEAT_RADIUS;
  const seatZ = Math.cos(a) * CANOPY_SEAT_RADIUS;
  const cosA = Math.cos(a);
  const sinA = Math.sin(a);

  return UPPER_BODY_OFFSETS.map(({ region, r, f, y }) => {
    const x = seatX + r * cosA + f * sinA;
    const z = seatZ - r * sinA + f * cosA;
    return {
      region,
      point: new THREE.Vector3(x, y, z),
    };
  });
});

/**
 * Calculates upper-body person shade coverage across seated visitors under the canopy.
 * Evaluates representative 3D points on head, neck, shoulders, and torso, casting rays
 * toward the sun against opaque canopy roof meshes.
 */
export function calculatePersonUpperBodyShade(
  opaqueRoofMeshes: THREE.Mesh[],
  sunDirection: THREE.Vector3,
  occupancy = 8,
): PersonUpperBodyShadeResult {
  const directSunAvailable = sunDirection.lengthSq() > 0 && sunDirection.y > 0;
  const numPeople = Math.min(8, Math.max(0, Math.floor(occupancy)));

  if (!directSunAvailable || numPeople === 0) {
    const emptyPeople: PersonShadeBreakdown[] = [];
    for (let i = 0; i < numPeople; i++) {
      emptyPeople.push({
        personIndex: i,
        totalSamples: PERSON_UPPER_BODY_SAMPLES[i].length,
        shadedSamples: 0,
        coveragePercent: 0,
        regions: {
          head: { total: 2, shaded: 0 },
          neck: { total: 1, shaded: 0 },
          shoulders: { total: 2, shaded: 0 },
          torso: { total: 4, shaded: 0 },
        },
      });
    }
    return {
      coveragePercent: 0,
      directSunAvailable,
      occupancy: numPeople,
      shadedSamples: 0,
      totalSamples: numPeople * UPPER_BODY_OFFSETS.length,
      people: emptyPeople,
    };
  }

  opaqueRoofMeshes.forEach(mesh => mesh.updateWorldMatrix(true, false));
  const raycaster = new THREE.Raycaster();
  raycaster.near = 0;
  raycaster.far = Number.POSITIVE_INFINITY;
  const direction = sunDirection.clone().normalize();
  const intersections: THREE.Intersection[] = [];

  let totalShaded = 0;
  let totalSamples = 0;
  const peopleBreakdowns: PersonShadeBreakdown[] = [];

  for (let i = 0; i < numPeople; i++) {
    const samples = PERSON_UPPER_BODY_SAMPLES[i];
    let personShaded = 0;
    const regionCounts = {
      head: { total: 0, shaded: 0 },
      neck: { total: 0, shaded: 0 },
      shoulders: { total: 0, shaded: 0 },
      torso: { total: 0, shaded: 0 },
    };

    for (const sample of samples) {
      regionCounts[sample.region].total++;
      raycaster.set(sample.point, direction);
      intersections.length = 0;
      raycaster.intersectObjects(opaqueRoofMeshes, false, intersections);
      if (intersections.length > 0) {
        personShaded++;
        regionCounts[sample.region].shaded++;
      }
    }

    totalShaded += personShaded;
    totalSamples += samples.length;
    peopleBreakdowns.push({
      personIndex: i,
      totalSamples: samples.length,
      shadedSamples: personShaded,
      coveragePercent: Math.round((personShaded / samples.length) * 1000) / 10,
      regions: regionCounts,
    });
  }

  const coveragePercent = totalSamples > 0
    ? Math.round((totalShaded / totalSamples) * 1000) / 10
    : 0;

  return {
    coveragePercent,
    directSunAvailable: true,
    occupancy: numPeople,
    shadedSamples: totalShaded,
    totalSamples,
    people: peopleBreakdowns,
  };
}
