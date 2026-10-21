import * as THREE from 'three';

export type GroundShadeResult = {
  /** Estimated fraction of the configured ground region shaded from direct sun. */
  coveragePercent: number;
  /** False when the sun is on or below the horizon; zero then means unavailable. */
  directSunAvailable: boolean;
  shadedSamples: number;
  totalSamples: number;
  sampleSpacing: number;
};

export type GroundShadeOptions = {
  radius: number;
  sampleSpacing: number;
  centerX?: number;
  centerZ?: number;
};

// Candidate poses share the same occupied-area grid. Cache only a few grids so
// custom tests or future configurations cannot grow this indefinitely.
const sampleGridCache = new Map<string, THREE.Vector3[]>();

function circleSamples(radius: number, spacing: number, centerX: number, centerZ: number) {
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('Occupied-area radius must be positive.');
  if (!Number.isFinite(spacing) || spacing <= 0) throw new RangeError('Sample spacing must be positive.');
  if (!Number.isFinite(centerX) || !Number.isFinite(centerZ)) throw new RangeError('Occupied-area centre must be finite.');

  const key = `${radius}:${spacing}:${centerX}:${centerZ}`;
  const cached = sampleGridCache.get(key);
  if (cached) {
    // Refresh insertion order for a small least-recently-used cache.
    sampleGridCache.delete(key);
    sampleGridCache.set(key, cached);
    return cached;
  }

  const points: THREE.Vector3[] = [];
  const halfStep = spacing / 2;
  const radiusSquared = radius * radius;
  for (let z = -radius + halfStep; z < radius; z += spacing) {
    for (let x = -radius + halfStep; x < radius; x += spacing) {
      if (x * x + z * z <= radiusSquared) points.push(new THREE.Vector3(centerX + x, 0, centerZ + z));
    }
  }
  // Keep a valid estimate for a very small region sampled with a coarse grid.
  if (points.length === 0) points.push(new THREE.Vector3(centerX, 0, centerZ));
  if (sampleGridCache.size >= 8) sampleGridCache.delete(sampleGridCache.keys().next().value!);
  sampleGridCache.set(key, points);
  return points;
}

/**
 * Estimate area coverage over a fixed circular ground region. Only the supplied
 * opaque roof meshes are considered; callers must keep other scene objects out.
 * Samples use the same regular grid for every sun position and roof transform.
 */
export function calculateGroundAreaShade(
  opaqueRoofMeshes: THREE.Mesh[],
  sunDirection: THREE.Vector3,
  options: GroundShadeOptions,
): GroundShadeResult {
  const points = circleSamples(options.radius, options.sampleSpacing, options.centerX ?? 0, options.centerZ ?? 0);
  const directSunAvailable = sunDirection.lengthSq() > 0 && sunDirection.y > 0;
  if (!directSunAvailable) {
    return {
      coveragePercent: 0,
      directSunAvailable: false,
      shadedSamples: 0,
      totalSamples: points.length,
      sampleSpacing: options.sampleSpacing,
    };
  }

  opaqueRoofMeshes.forEach(mesh => mesh.updateWorldMatrix(true, false));
  const raycaster = new THREE.Raycaster();
  raycaster.near = 0;
  raycaster.far = Number.POSITIVE_INFINITY;
  const direction = sunDirection.clone().normalize();
  // Raycaster's default creates a fresh intersections array for every sample.
  // Reuse one scratch array; the returned intersections are only queried for
  // whether the ray hit anything.
  const intersections: THREE.Intersection[] = [];
  let shadedSamples = 0;
  for (const point of points) {
    raycaster.set(point, direction);
    intersections.length = 0;
    raycaster.intersectObjects(opaqueRoofMeshes, false, intersections);
    if (intersections.length > 0) shadedSamples++;
  }

  return {
    coveragePercent: Math.round((shadedSamples / points.length) * 1000) / 10,
    directSunAvailable: true,
    shadedSamples,
    totalSamples: points.length,
    sampleSpacing: options.sampleSpacing,
  };
}
