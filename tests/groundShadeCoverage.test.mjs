import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { calculateGroundAreaShade } from '../src/park/groundShadeCoverage.ts';
import { createEcoCanopyModel, createOpaqueRoofSurfaces } from '../src/park/createEcoCanopyModel.ts';
import {
  dampCanopyPose,
  normalizeAngleDeg,
  normalizeAngleRad,
  shortestAngleDifferenceDeg,
  shortestAngleDifferenceRad,
} from '../src/park/canopyPose.ts';
import {
  PERSON_UPPER_BODY_SAMPLES,
  calculatePersonUpperBodyShade,
} from '../src/park/personUpperBodyShade.ts';
import { CANOPY_ROOF_PIVOT_HEIGHT, CANOPY_ROOF_RADIUS, CANOPY_SUPPORT_CLEARANCE_RADIUS } from '../src/park/canopyDimensions.ts';
import {
  createGroundShadeResultCache,
  createPersonShadeResultCache,
  groundAreaShadeCoverage,
  groundShadeCoverageCacheKey,
  personUpperBodyShadeCoverage,
  personUpperBodyShadeCoverageCacheKey,
  sunPosition3d,
} from '../src/simulation.ts';

const verticalSun = new THREE.Vector3(0, 1, 0);

function horizontalRoof(width, depth, x = 0, y = 2, z = 0) {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  roof.rotation.x = -Math.PI / 2;
  roof.position.set(x, y, z);
  roof.updateMatrixWorld(true);
  return roof;
}

function measure(meshes, sun = verticalSun, radius = 1, sampleSpacing = 0.05, centerX = 0, centerZ = 0) {
  return calculateGroundAreaShade(meshes, sun, { radius, sampleSpacing, centerX, centerZ });
}

test('a roof whose shadow contains the occupied circle gives full coverage', () => {
  const result = measure([horizontalRoof(4, 4)], verticalSun, 1);
  assert.equal(result.directSunAvailable, true);
  assert.equal(result.coveragePercent, 100);
});

test('a roof shadow covering only part of the occupied circle gives partial coverage', () => {
  const result = measure([horizontalRoof(1, 4, 0.5)], verticalSun, 1);
  assert.ok(result.coveragePercent > 30 && result.coveragePercent < 70, `${result.coveragePercent}%`);
});

test('daylight with a roof shadow missing the occupied area is zero coverage', () => {
  const result = measure([horizontalRoof(4, 4, 5)], verticalSun, 1);
  assert.equal(result.directSunAvailable, true);
  assert.equal(result.coveragePercent, 0);
});

test('the fixed occupied-area centre can be configured independently of the roof', () => {
  const result = measure([horizontalRoof(4, 4, 5)], verticalSun, 1, 0.05, 5, 0);
  assert.equal(result.coveragePercent, 100);
});

test('a roof too small to cover the occupied circle is not reported as fully shaded', () => {
  const result = measure([horizontalRoof(0.5, 0.5)], verticalSun, 1);
  assert.ok(result.coveragePercent > 0 && result.coveragePercent < 20, `${result.coveragePercent}%`);
});

test('changing the sun direction changes the ground shadow and coverage', () => {
  const roof = horizontalRoof(4, 4);
  const overhead = measure([roof], verticalSun, 1);
  const lowSunFromEast = measure([roof], new THREE.Vector3(1, 1, 0), 1);
  assert.equal(overhead.coveragePercent, 100);
  assert.ok(lowSunFromEast.coveragePercent > 35 && lowSunFromEast.coveragePercent < 65,
    `${lowSunFromEast.coveragePercent}%`);
});

test('coverage estimate stabilizes as the fixed grid is refined', () => {
  const roof = horizontalRoof(1, 4, 0.5);
  const coarse = measure([roof], verticalSun, 1, 0.2).coveragePercent;
  const medium = measure([roof], verticalSun, 1, 0.1).coveragePercent;
  const fine = measure([roof], verticalSun, 1, 0.05).coveragePercent;
  assert.ok(Math.abs(medium - fine) <= 1.5, `medium ${medium}%, fine ${fine}%`);
  assert.ok(Math.abs(coarse - fine) <= 3, `coarse ${coarse}%, fine ${fine}%`);
});

test('below-horizon sun is reported as unavailable, distinct from daylight zero coverage', () => {
  const roof = horizontalRoof(4, 4, 5);
  const daylightMiss = measure([roof], verticalSun, 1);
  const unavailable = measure([roof], new THREE.Vector3(0, -1, 0), 1);
  assert.equal(daylightMiss.coveragePercent, 0);
  assert.equal(daylightMiss.directSunAvailable, true);
  assert.equal(unavailable.coveragePercent, 0);
  assert.equal(unavailable.directSunAvailable, false);

  const nightSun = sunPosition3d('2026-06-21', 0, 0, 101.686);
  assert.ok(nightSun.rawElevation < 0);
  const nightResult = groundAreaShadeCoverage(nightSun, 0, 0);
  assert.equal(nightResult.directSunAvailable, false);
});

test('the actual roof meshes respond to a transformed canopy pose', () => {
  const roof = createOpaqueRoofSurfaces(true);
  const root = new THREE.Group();
  const yaw = new THREE.Group();
  yaw.position.y = 2.35;
  const tilt = new THREE.Group();
  root.add(yaw);
  yaw.add(tilt);
  tilt.add(roof.group);

  const neutral = measure(roof.meshes, verticalSun, 1.35, 0.1);
  root.position.x = 8;
  const translated = measure(roof.meshes, verticalSun, 1.35, 0.1);
  assert.equal(neutral.coveragePercent, 100);
  assert.equal(translated.coveragePercent, 0);
});

test('the shade cache key changes for every shade input and ignores unrelated controls', () => {
  const base = { date: '2026-06-21', minute: 570, latitude: 3.139, longitude: 101.686, angle: 0, heading: 0 };
  const key = groundShadeCoverageCacheKey(base);
  const variants = [
    { ...base, date: '2026-06-22' },
    { ...base, minute: 571 },
    { ...base, latitude: 3.14 },
    { ...base, longitude: 101.687 },
    { ...base, angle: 1 },
    { ...base, heading: 1 },
  ];
  for (const variant of variants) assert.notEqual(groundShadeCoverageCacheKey(variant), key);
  assert.equal(groundShadeCoverageCacheKey({ ...base, sunlight: 20, battery: 50, occupancy: 8, fanSpeed: 'High' }), key);
});

test('unrelated control updates reuse shade and the settled final inputs get an exact result', () => {
  const cache = createGroundShadeResultCache();
  const start = { date: '2026-06-21', minute: 570, latitude: 3.139, longitude: 101.686, angle: 0, heading: 0 };
  const final = { ...start, minute: 571, angle: 10, heading: -20 };
  const startKey = groundShadeCoverageCacheKey(start);
  const finalKey = groundShadeCoverageCacheKey(final);
  let calculations = 0;
  const placeholder = { coveragePercent: 0, directSunAvailable: true, shadedSamples: 0, totalSamples: 577, sampleSpacing: 0.1 };

  assert.equal(cache.getOrCalculate(startKey, () => { calculations++; return placeholder; }), placeholder);
  assert.equal(cache.getOrCalculate(groundShadeCoverageCacheKey({ ...start, sunlight: 78, battery: 76 }), () => {
    calculations++;
    return { ...placeholder, coveragePercent: 100 };
  }), placeholder);
  assert.equal(calculations, 1);

  const finalSun = sunPosition3d(final.date, final.minute, final.latitude, final.longitude);
  const settledResult = cache.getOrCalculate(finalKey, () => {
    calculations++;
    return groundAreaShadeCoverage(finalSun, final.angle, final.heading);
  });
  assert.deepEqual(settledResult, groundAreaShadeCoverage(finalSun, final.angle, final.heading));
  assert.equal(cache.getOrCalculate(finalKey, () => { calculations++; return placeholder; }), settledResult);
  assert.equal(calculations, 2);
});

function cylinderContainsLocalPoint(geometry, point) {
  const { height, radiusTop, radiusBottom } = geometry.parameters;
  const halfHeight = height / 2;
  if (point.y < -halfHeight || point.y > halfHeight) return false;
  const t = (point.y + halfHeight) / height;
  const radius = radiusBottom + (radiusTop - radiusBottom) * t;
  return point.x * point.x + point.z * point.z <= radius * radius;
}

function movingSolidContainsLocalPoint(mesh, point) {
  const { geometry } = mesh;
  if (geometry.userData.annularFrustum) {
    const { topRadius, bottomRadius, innerRadius, height } = geometry.userData.annularFrustum;
    const halfHeight = height / 2;
    if (point.y < -halfHeight || point.y > halfHeight) return false;
    const t = (point.y + halfHeight) / height;
    const outerRadius = bottomRadius + (topRadius - bottomRadius) * t;
    const radiusSquared = point.x * point.x + point.z * point.z;
    return radiusSquared >= innerRadius * innerRadius
      && radiusSquared <= outerRadius * outerRadius;
  }
  if (geometry.type === 'CylinderGeometry') {
    const { height, radiusTop, radiusBottom } = geometry.parameters;
    const halfHeight = height / 2;
    if (point.y < -halfHeight || point.y > halfHeight) return false;
    const t = (point.y + halfHeight) / height;
    const radius = radiusBottom + (radiusTop - radiusBottom) * t;
    return point.x * point.x + point.z * point.z <= radius * radius;
  }
  if (geometry.type === 'BoxGeometry') {
    const { width, height, depth } = geometry.parameters;
    return Math.abs(point.x) <= width / 2
      && Math.abs(point.y) <= height / 2
      && Math.abs(point.z) <= depth / 2;
  }
  return false;
}

function sampleCylinderInterior(mesh, step, topOnly = false) {
  const { height, radiusTop, radiusBottom } = mesh.geometry.parameters;
  const halfHeight = height / 2;
  const minY = topOnly ? halfHeight - 0.25 : -halfHeight;
  const points = [];
  for (let y = minY; y <= halfHeight; y += step) {
    const t = (y + halfHeight) / height;
    const radius = radiusBottom + (radiusTop - radiusBottom) * t;
    for (let x = -radius; x <= radius; x += step) {
      for (let z = -radius; z <= radius; z += step) {
        if (x * x + z * z <= radius * radius) {
          points.push(new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld));
        }
      }
    }
  }
  return points;
}

test('moving roof, ribs, and fan solids clear the fixed support at neutral and plus or minus 30 degrees', () => {
  const canopy = createEcoCanopyModel();
  const supports = canopy.root.children.filter(child =>
    child.name === 'canopy-support-pillar' || child.name === 'fixed-roof-bearing');
  const pillar = supports.find(child => child.name === 'canopy-support-pillar');
  const bearing = supports.find(child => child.name === 'fixed-roof-bearing');
  assert.ok(pillar && bearing, 'the fixed pillar and bearing are present');
  const roofGeometry = canopy.opaqueRoofMeshes[0].geometry.userData.annularFrustum;
  assert.equal(roofGeometry.topRadius, CANOPY_ROOF_RADIUS);
  assert.equal(roofGeometry.bottomRadius, CANOPY_ROOF_RADIUS - 0.16);
  assert.equal(roofGeometry.innerRadius, CANOPY_SUPPORT_CLEARANCE_RADIUS);

  const movingMeshes = [];
  canopy.roofTilt.traverse(child => {
    if (child instanceof THREE.Mesh) movingMeshes.push(child);
  });

  for (const tilt of [0, -30, 30]) {
    canopy.roofTilt.rotation.x = THREE.MathUtils.degToRad(tilt);
    canopy.root.updateMatrixWorld(true);
    const supportSamples = [
      ...sampleCylinderInterior(bearing, 0.025),
      ...sampleCylinderInterior(pillar, 0.025, true),
    ];
    const movingTransforms = movingMeshes.map(mesh => ({
      mesh,
      inverse: mesh.matrixWorld.clone().invert(),
    }));

    for (const supportPoint of supportSamples) {
      for (const { mesh, inverse } of movingTransforms) {
        if (movingSolidContainsLocalPoint(mesh, supportPoint.clone().applyMatrix4(inverse))) {
          assert.fail(`${mesh.name || mesh.geometry.type} intersects a fixed support at ${tilt} degrees`);
        }
      }
    }

    // Also catch thin/open meshes whose vertices might enter the support volume.
    const inverseSupportMatrices = supports.map(support => support.matrixWorld.clone().invert());
    for (const movingMesh of movingMeshes) {
      const positions = movingMesh.geometry.getAttribute('position');
      if (!positions || movingMesh.geometry.userData.annularFrustum) continue;
      for (let index = 0; index < positions.count; index++) {
        const worldVertex = new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(movingMesh.matrixWorld);
        for (let supportIndex = 0; supportIndex < supports.length; supportIndex++) {
          const supportLocal = worldVertex.clone().applyMatrix4(inverseSupportMatrices[supportIndex]);
          if (cylinderContainsLocalPoint(supports[supportIndex].geometry, supportLocal)) {
            assert.fail(`${movingMesh.name || movingMesh.geometry.type} enters a fixed support at ${tilt} degrees`);
          }
        }
      }
    }
  }
});

test('rendered canopy pivots follow changed heading and manual degree targets', () => {
  const canopy = createEcoCanopyModel();
  let current = { yaw: 0, tilt: 0 };

  const poseRoof = target => {
    for (let frame = 0; frame < 600; frame++) {
      current = dampCanopyPose(canopy, current, target, 0.016);
    }
    canopy.root.updateMatrixWorld(true);
  };
  const roofVertexWorldPosition = () => {
    const mesh = canopy.opaqueRoofMeshes[0];
    const vertex = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), 0);
    return vertex.applyMatrix4(mesh.matrixWorld);
  };

  poseRoof({ heading: 30, tilt: 15 });
  assert.ok(Math.abs(canopy.roofYaw.rotation.y - THREE.MathUtils.degToRad(30)) < 1e-10);
  assert.ok(Math.abs(canopy.roofTilt.rotation.x - THREE.MathUtils.degToRad(15)) < 1e-10);
  const manualPoseVertex = roofVertexWorldPosition();

  poseRoof({ heading: -75, tilt: -30 });
  assert.ok(Math.abs(canopy.roofYaw.rotation.y - THREE.MathUtils.degToRad(-75)) < 1e-10);
  assert.ok(Math.abs(canopy.roofTilt.rotation.x - THREE.MathUtils.degToRad(-30)) < 1e-10);
  assert.ok(roofVertexWorldPosition().distanceTo(manualPoseVertex) > 0.1);
});

test('heading adjustment takes shortest angle across wraparound boundaries (e.g. 350° to 10° rotates 20°, not 340°)', () => {
  const canopy = createEcoCanopyModel();
  let current = { yaw: THREE.MathUtils.degToRad(350), tilt: 0 };
  let totalArc = 0;
  for (let frame = 0; frame < 600; frame++) {
    const next = dampCanopyPose(canopy, current, { heading: 10, tilt: 0 }, 0.016);
    totalArc += Math.abs(shortestAngleDifferenceRad(next.yaw, current.yaw));
    current = next;
  }
  // The shortest arc from 350° to 10° is 20° (0.349 rad).
  // If it spun the long way around, totalArc would be >= 340° (5.93 rad).
  assert.ok(totalArc < THREE.MathUtils.degToRad(25), `Expected < 25° total rotation, but travelled ${THREE.MathUtils.radToDeg(totalArc)}°`);
  assert.ok(Math.abs(shortestAngleDifferenceDeg(10, THREE.MathUtils.radToDeg(canopy.roofYaw.rotation.y))) < 1e-6);

  // Reverse: moving from 10° to 350° should also take the 20° arc
  current = { yaw: THREE.MathUtils.degToRad(10), tilt: 0 };
  totalArc = 0;
  for (let frame = 0; frame < 600; frame++) {
    const next = dampCanopyPose(canopy, current, { heading: 350, tilt: 0 }, 0.016);
    totalArc += Math.abs(shortestAngleDifferenceRad(next.yaw, current.yaw));
    current = next;
  }
  assert.ok(totalArc < THREE.MathUtils.degToRad(25), `Expected < 25° total rotation, but travelled ${THREE.MathUtils.radToDeg(totalArc)}°`);
  assert.ok(Math.abs(shortestAngleDifferenceDeg(350, THREE.MathUtils.radToDeg(canopy.roofYaw.rotation.y))) < 1e-6);
});

test('heading adjustment handles 170° to -170° and reversing targets mid-motion smoothly', () => {
  const canopy = createEcoCanopyModel();
  let current = { yaw: THREE.MathUtils.degToRad(170), tilt: 0 };
  let totalArc = 0;
  for (let frame = 0; frame < 600; frame++) {
    const next = dampCanopyPose(canopy, current, { heading: -170, tilt: 0 }, 0.016);
    totalArc += Math.abs(shortestAngleDifferenceRad(next.yaw, current.yaw));
    current = next;
  }
  // 170° to -170° shortest arc is 20°
  assert.ok(totalArc < THREE.MathUtils.degToRad(25));
  assert.ok(Math.abs(shortestAngleDifferenceDeg(-170, THREE.MathUtils.radToDeg(canopy.roofYaw.rotation.y))) < 1e-6);

  // Changing target mid-motion
  current = { yaw: 0, tilt: 0 };
  for (let frame = 0; frame < 15; frame++) {
    current = dampCanopyPose(canopy, current, { heading: 90, tilt: 0 }, 0.016);
  }
  // Reversing to -45° while still moving towards 90°
  totalArc = 0;
  for (let frame = 0; frame < 600; frame++) {
    const next = dampCanopyPose(canopy, current, { heading: -45, tilt: 0 }, 0.016);
    totalArc += Math.abs(shortestAngleDifferenceRad(next.yaw, current.yaw));
    current = next;
  }
  assert.ok(totalArc < THREE.MathUtils.degToRad(150));
  assert.ok(Math.abs(shortestAngleDifferenceDeg(-45, THREE.MathUtils.radToDeg(canopy.roofYaw.rotation.y))) < 1e-6);
});

test('tilt is handled separately from heading and does not wrap around', () => {
  const canopy = createEcoCanopyModel();
  let current = { yaw: 0, tilt: THREE.MathUtils.degToRad(-25) };
  for (let frame = 0; frame < 600; frame++) {
    current = dampCanopyPose(canopy, current, { heading: 0, tilt: 25 }, 0.016);
  }
  assert.ok(Math.abs(canopy.roofTilt.rotation.x - THREE.MathUtils.degToRad(25)) < 1e-10);
});

test('upper-body person shade evaluates head, neck, shoulders, and torso, excluding legs and ground', () => {
  assert.equal(PERSON_UPPER_BODY_SAMPLES.length, 8);
  for (const personSamples of PERSON_UPPER_BODY_SAMPLES) {
    assert.equal(personSamples.length, 9);
    for (const sample of personSamples) {
      assert.ok(['head', 'neck', 'shoulders', 'torso'].includes(sample.region));
      // Ground is y = 0, legs are y < 0.50. Upper-body points must be strictly >= 0.55m
      assert.ok(sample.point.y >= 0.55, `Sample point height ${sample.point.y} should be >= 0.55m (excluding legs and ground)`);
      assert.ok(sample.point.y <= 1.15, `Sample point height ${sample.point.y} should be <= 1.15m`);
    }
    // Verify each region is present
    const regions = new Set(personSamples.map(s => s.region));
    assert.ok(regions.has('head'));
    assert.ok(regions.has('neck'));
    assert.ok(regions.has('shoulders'));
    assert.ok(regions.has('torso'));
  }
});

test('overhead sun provides complete upper-body person shade under horizontal canopy', () => {
  const roof = createOpaqueRoofSurfaces(true);
  roof.group.position.y = CANOPY_ROOF_PIVOT_HEIGHT;
  roof.group.updateMatrixWorld(true);
  const overheadSun = new THREE.Vector3(0, 1, 0);
  const result = calculatePersonUpperBodyShade(roof.meshes, overheadSun, 8);

  assert.equal(result.directSunAvailable, true);
  assert.equal(result.occupancy, 8);
  assert.equal(result.totalSamples, 72);
  assert.equal(result.shadedSamples, 72);
  assert.equal(result.coveragePercent, 100);
  assert.equal(result.people.length, 8);
  for (const person of result.people) {
    assert.equal(person.coveragePercent, 100);
    assert.equal(person.shadedSamples, 9);
  }
});

test('person shade respects occupancy and reports unavailable at night', () => {
  const roof = createOpaqueRoofSurfaces(true);
  roof.group.position.y = CANOPY_ROOF_PIVOT_HEIGHT;
  roof.group.updateMatrixWorld(true);
  const overheadSun = new THREE.Vector3(0, 1, 0);

  // Occupancy 3
  const result3 = calculatePersonUpperBodyShade(roof.meshes, overheadSun, 3);
  assert.equal(result3.occupancy, 3);
  assert.equal(result3.totalSamples, 27);
  assert.equal(result3.shadedSamples, 27);
  assert.equal(result3.coveragePercent, 100);

  // Occupancy 0
  const result0 = calculatePersonUpperBodyShade(roof.meshes, overheadSun, 0);
  assert.equal(result0.occupancy, 0);
  assert.equal(result0.totalSamples, 0);
  assert.equal(result0.shadedSamples, 0);
  assert.equal(result0.coveragePercent, 0);

  // Night / sun below horizon
  const nightSun = new THREE.Vector3(0, -1, 0);
  const nightResult = calculatePersonUpperBodyShade(roof.meshes, nightSun, 5);
  assert.equal(nightResult.directSunAvailable, false);
  assert.equal(nightResult.coveragePercent, 0);
  assert.equal(nightResult.shadedSamples, 0);
});

test('personUpperBodyShadeCoverage integration responds to sun angle, canopy tilt, and cache', () => {
  const noonSun = sunPosition3d('2026-10-21', 13 * 60, 3.139, 101.686);
  // Overhead noon sun provides complete shade
  const shadeNoon = personUpperBodyShadeCoverage(noonSun, 0, 0, 8);
  assert.equal(shadeNoon.directSunAvailable, true);
  assert.equal(shadeNoon.coveragePercent, 100);

  const morningSun = sunPosition3d('2026-10-21', 9 * 60, 3.139, 101.686);
  // Tilting canopy towards morning sun (-15°) improves shade compared to tilting away (+25°)
  const shadeTiltedToward = personUpperBodyShadeCoverage(morningSun, -15, 0, 8);
  const shadeTiltedAway = personUpperBodyShadeCoverage(morningSun, 25, 0, 8);
  assert.ok(shadeTiltedToward.coveragePercent > shadeTiltedAway.coveragePercent,
    `Tilted toward (${shadeTiltedToward.coveragePercent}%) should be > tilted away (${shadeTiltedAway.coveragePercent}%)`);

  // Cache key includes occupancy and canopy angles
  const key1 = personUpperBodyShadeCoverageCacheKey({
    date: '2026-10-21', minute: 540, latitude: 3.139, longitude: 101.686, angle: 0, heading: 0, occupancy: 5,
  });
  const key2 = personUpperBodyShadeCoverageCacheKey({
    date: '2026-10-21', minute: 540, latitude: 3.139, longitude: 101.686, angle: 0, heading: 0, occupancy: 8,
  });
  assert.notEqual(key1, key2);

  const cache = createPersonShadeResultCache();
  const cached1 = cache.getOrCalculate(key1, () => shadeNoon);
  assert.equal(cached1, shadeNoon);
  assert.equal(cache.getOrCalculate(key1, () => { throw new Error('should not recompute'); }), shadeNoon);
});
