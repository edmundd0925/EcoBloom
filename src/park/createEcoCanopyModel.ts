import * as THREE from 'three';
import {
  CANOPY_ROOF_PIVOT_HEIGHT,
  CANOPY_ROOF_RADIUS,
  CANOPY_ROOF_UNDERSIDE_OFFSET,
  CANOPY_SEAT_RADIUS,
  CANOPY_SUPPORT_CLEARANCE_RADIUS,
} from './canopyDimensions.ts';

export type CanopyModel = {
  root: THREE.Group;
  roofYaw: THREE.Group;
  roofTilt: THREE.Group;
  opaqueRoofMeshes: THREE.Mesh[];
  fan: THREE.Group;
  led: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
  fanIndicator?: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
};

/** Increment when the opaque shell geometry used for area shade changes. */
export const OPAQUE_ROOF_SHADE_GEOMETRY_VERSION = 2;

const metal = (color: number, roughness = .42) => new THREE.MeshStandardMaterial({ color, metalness: .68, roughness });
const mesh = <T extends THREE.BufferGeometry, M extends THREE.Material>(geometry: T, material: M) => {
  const item = new THREE.Mesh(geometry, material); item.castShadow = true; item.receiveShadow = true; return item;
};

function createAnnularFrustumGeometry(
  topRadius: number,
  bottomRadius: number,
  innerRadius: number,
  height: number,
  radialSegments: number,
) {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];
  const halfHeight = height / 2;
  const ring = (radius: number, y: number) => Array.from({ length: radialSegments }, (_, index) => {
    const angle = index / radialSegments * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  });

  const appendSurface = (
    rings: THREE.Vector3[][],
    triangles: (offset: number, index: number, next: number) => number[][],
  ) => {
    const offset = positions.length / 3;
    rings.flat().forEach(vertex => positions.push(vertex.x, vertex.y, vertex.z));
    for (let index = 0; index < radialSegments; index++) {
      const next = (index + 1) % radialSegments;
      triangles(offset, index, next).forEach(triangle => indices.push(...triangle));
    }
  };

  const bottomOuter = ring(bottomRadius, -halfHeight);
  const topOuter = ring(topRadius, halfHeight);
  const bottomInner = ring(innerRadius, -halfHeight);
  const topInner = ring(innerRadius, halfHeight);

  // Separate surfaces preserve smooth curved walls and crisp annular faces.
  appendSurface([bottomOuter, topOuter], (offset, index, next) => {
    const bottom = offset + index, top = offset + radialSegments + index;
    const bottomNext = offset + next, topNext = offset + radialSegments + next;
    return [[bottom, top, bottomNext], [bottomNext, top, topNext]];
  });
  appendSurface([topInner, topOuter], (offset, index, next) => {
    const inner = offset + index, outer = offset + radialSegments + index;
    const innerNext = offset + next, outerNext = offset + radialSegments + next;
    return [[inner, outerNext, outer], [inner, innerNext, outerNext]];
  });
  appendSurface([bottomOuter, bottomInner], (offset, index, next) => {
    const outer = offset + index, inner = offset + radialSegments + index;
    const outerNext = offset + next, innerNext = offset + radialSegments + next;
    return [[outer, outerNext, inner], [outerNext, innerNext, inner]];
  });
  appendSurface([bottomInner, topInner], (offset, index, next) => {
    const bottom = offset + index, top = offset + radialSegments + index;
    const bottomNext = offset + next, topNext = offset + radialSegments + next;
    return [[bottom, bottomNext, top], [bottomNext, topNext, top]];
  });

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.annularFrustum = { topRadius, bottomRadius, innerRadius, height };
  return geometry;
}

/**
 * These are the only meshes used as opaque roof surfaces by the shade estimator.
 * The raycast variant uses DoubleSide so rays from beneath can hit the underside;
 * the rendered variant keeps the original material sidedness.
 */
export function createOpaqueRoofSurfaces(doubleSidedForRaycasting = false) {
  const side = doubleSidedForRaycasting ? THREE.DoubleSide : THREE.FrontSide;
  const roofGroup = new THREE.Group();
  roofGroup.name = 'opaque-roof-surfaces';

  const undersideMaterial = metal(0x343f45, .68);
  undersideMaterial.side = side;
  const underside = mesh(
    createAnnularFrustumGeometry(
      CANOPY_ROOF_RADIUS,
      CANOPY_ROOF_RADIUS - .16,
      CANOPY_SUPPORT_CLEARANCE_RADIUS,
      .16,
      64,
    ),
    undersideMaterial,
  );
  underside.name = 'roof-underside';
  underside.position.y = CANOPY_ROOF_UNDERSIDE_OFFSET;
  roofGroup.add(underside);

  const domeMaterial = new THREE.MeshStandardMaterial({ color: 0x263d4a, metalness: .3, roughness: .5, side });
  const dome = mesh(
    new THREE.SphereGeometry(CANOPY_ROOF_RADIUS, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2),
    domeMaterial,
  );
  dome.name = 'roof-dome';
  dome.scale.y = .25;
  dome.position.y = .1;
  // The dome is rotationally symmetric; offset its triangle seam from the shade sample grid.
  dome.rotation.y = Math.PI / 64;
  roofGroup.add(dome);

  return { group: roofGroup, meshes: [underside, dome] };
}

/** Inferred from the supplied canopy sheet. Units are illustrative metres; +X east, +Y up, +Z north. */
export function createEcoCanopyModel(): CanopyModel {
  const root = new THREE.Group(); root.name = 'EcoCanopy';
  const wood = new THREE.MeshStandardMaterial({ color: 0x99603b, roughness: .68 });
  const warm = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xa66b1b, emissiveIntensity: 0, roughness: .4 });
  const pillar = mesh(new THREE.CylinderGeometry(.19, .24, 2.26, 32), metal(0xaebbc2, .46)); pillar.name = 'canopy-support-pillar'; pillar.position.y = 1.13; root.add(pillar);
  const base = mesh(new THREE.CylinderGeometry(1.38, 1.48, .18, 48), metal(0x5c6667,.45)); base.position.y=.09; root.add(base);
  const seat = new THREE.Group(); seat.name='seating';
  for(let i=0;i<26;i++){ const a=i/26*Math.PI*2; const slat=mesh(new THREE.BoxGeometry(.17,.12,.62),wood); slat.position.set(Math.sin(a)*CANOPY_SEAT_RADIUS,.42,Math.cos(a)*CANOPY_SEAT_RADIUS); slat.rotation.y=-a; seat.add(slat); }
  const seatRing=mesh(new THREE.TorusGeometry(1.05,.05,10,48),metal(0x59666d,.5)); seatRing.position.y=.33; seatRing.rotation.x=Math.PI/2; seat.add(seatRing); root.add(seat);
  const bearing = mesh(new THREE.CylinderGeometry(.36,.36,.14,32),metal(0x3d4547,.22)); bearing.name = 'fixed-roof-bearing'; bearing.position.y=2.28; root.add(bearing);
  const roofYaw=new THREE.Group(); roofYaw.name='roof-yaw-pivot'; roofYaw.position.y=CANOPY_ROOF_PIVOT_HEIGHT; root.add(roofYaw);
  const roofTilt=new THREE.Group(); roofTilt.name='roof-tilt-pivot'; roofYaw.add(roofTilt);
  const opaqueRoof = createOpaqueRoofSurfaces();
  roofTilt.add(opaqueRoof.group);
  // Two raised photovoltaic modules sit symmetrically on opposite sides of the dome.
  const panelSurface = new THREE.MeshStandardMaterial({
    color: 0x103b60,
    metalness: 0.18,
    roughness: 0.46,
    side: THREE.DoubleSide,
  });

  const panelCell = new THREE.MeshStandardMaterial({
    color: 0x398bc4,
    metalness: 0.08,
    roughness: 0.5,
  });

  const panelFrame = metal(0xc6d0d5, 0.52);

  const panelRadius = 1.04;
  const panelWidth = 1.35;
  const panelLength = 1.22;
  const panelThickness = 0.06;
  const domeRadius = CANOPY_ROOF_RADIUS;
  const domeHeight = CANOPY_ROOF_RADIUS * 0.25;
  const domeBase = 0.1;
  const panelClearance = 0.035;

  for (const [index, angle] of [Math.PI / 2, (3 * Math.PI) / 2].entries()) {
    const panel = new THREE.Group();
    panel.name = `solar-panel-${index + 1}`;

    // The module's local Z axis points radially outward, matching the dome slope.
    const panelBody = mesh(
      new THREE.BoxGeometry(panelWidth, panelThickness, panelLength),
      panelSurface
    );
    panelBody.position.y = panelThickness / 2;
    panel.add(panelBody);

    // Raised blue cell lines remain visible above the panel face.
    for (let row = 1; row <= 2; row++) {
      const line = mesh(
        new THREE.BoxGeometry(panelWidth - 0.06, 0.008, 0.012),
        panelCell
      );
      line.position.z = -panelLength / 2 + row * (panelLength / 3);
      line.position.y = panelThickness + 0.006;
      panel.add(line);
    }

    for (let col = 1; col <= 3; col++) {
      const line = mesh(
        new THREE.BoxGeometry(0.012, 0.008, panelLength - 0.06),
        panelCell
      );
      line.position.x = -panelWidth / 2 + col * (panelWidth / 4);
      line.position.y = panelThickness + 0.006;
      panel.add(line);
    }

    // The shallow dome follows the shared radius and is raised 0.1 above the underside.
    const domeRoot = Math.sqrt(1 - (panelRadius * panelRadius) / (domeRadius * domeRadius));
    const roofY = domeBase + domeHeight * domeRoot;
    const slope = Math.atan2(
      domeHeight * panelRadius,
      domeRadius * domeRadius * domeRoot
    );
    panel.position.set(
      Math.sin(angle) * panelRadius,
      roofY + panelClearance,
      Math.cos(angle) * panelRadius
    );
    // Build a tangent frame explicitly so the panel normal follows the dome at each side.
    const radial = new THREE.Vector3(Math.sin(angle) * Math.cos(slope), -Math.sin(slope), Math.cos(angle) * Math.cos(slope));
    const normal = new THREE.Vector3(Math.sin(angle) * Math.sin(slope), Math.cos(slope), Math.cos(angle) * Math.sin(slope));
    const tangent = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    panel.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent, normal, radial));

    // Four slim silver rails outline the top of each module.
    const frameY = panelThickness + 0.012;
    const railThickness = 0.016;
    const rails = [
      [panelWidth + 0.02, railThickness, railThickness, 0, frameY, -panelLength / 2],
      [panelWidth + 0.02, railThickness, railThickness, 0, frameY, panelLength / 2],
      [railThickness, railThickness, panelLength - 0.015, -panelWidth / 2, frameY, 0],
      [railThickness, railThickness, panelLength - 0.015, panelWidth / 2, frameY, 0],
    ];
    for (const [railWidth, railHeight, railLength, railX, railPosY, railZ] of rails) {
      const rail = mesh(new THREE.BoxGeometry(railWidth, railHeight, railLength), panelFrame);
      rail.position.set(railX, railPosY, railZ);
      panel.add(rail);
    }
    roofTilt.add(panel);
  }
  const rim=mesh(new THREE.TorusGeometry(CANOPY_ROOF_RADIUS-.03,.075,12,64),metal(0xd3dadf,.46)); rim.rotation.x=Math.PI/2; rim.position.y=.03; roofTilt.add(rim);
  const ribInnerRadius = CANOPY_SUPPORT_CLEARANCE_RADIUS + .05;
  const ribOuterRadius = CANOPY_ROOF_RADIUS - .1;
  const ribLength = ribOuterRadius - ribInnerRadius;
  const ribCenterRadius = (ribInnerRadius + ribOuterRadius) / 2;
  for(let i=0;i<12;i++){ const a=i/12*Math.PI*2; const rib=mesh(new THREE.BoxGeometry(.05,.045,ribLength),metal(0x59666d,.52)); rib.name=`roof-rib-${i+1}`; rib.position.set(Math.sin(a)*ribCenterRadius,-.08,Math.cos(a)*ribCenterRadius); rib.rotation.y=a; roofTilt.add(rib); }
  const led=mesh(new THREE.TorusGeometry(1.54,.028,10,64),warm); led.rotation.x=Math.PI/2; led.position.y=-.1; roofTilt.add(led);
  const fan = new THREE.Group();
  fan.name = 'cooling-fan';
  // Positioned prominently within the central opening above the bearing clearance.
  fan.position.set(0, 0.36, 0);
  roofTilt.add(fan);

  // Aerodynamic rotor housing in satin metallic alloy
  const fanHousing = mesh(
    new THREE.CylinderGeometry(0.35, 0.38, 0.08, 36),
    metal(0xc8d5db, 0.36)
  );
  fanHousing.name = 'cooling-fan-housing';
  fanHousing.position.y = 0.06;
  fan.add(fanHousing);

  // Contrasting emerald hub housing the rotor mechanism
  const fanHub = mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 0.10, 24),
    metal(0x187a5a, 0.42)
  );
  fanHub.name = 'cooling-fan-hub';
  fanHub.position.y = 0.0;
  fan.add(fanHub);

  // Active cooling indicator beacon on the bottom center of the hub
  const fanIndicator = mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.02, 24),
    new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x34d399,
      emissiveIntensity: 0,
      roughness: 0.25,
      metalness: 0.1,
    })
  );
  fanIndicator.name = 'cooling-fan-indicator';
  fanIndicator.position.y = -0.05;
  fan.add(fanIndicator);

  // Five prominent high-contrast swept aerodynamic blades with dual-tone accent
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: 0x9de2d4,
    metalness: 0.25,
    roughness: 0.35,
    side: THREE.DoubleSide,
  });
  const tipMaterial = new THREE.MeshStandardMaterial({
    color: 0x187a5a,
    metalness: 0.35,
    roughness: 0.4,
    side: THREE.DoubleSide,
  });

  for (let i = 0; i < 5; i++) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.09, 0.15);
    shape.quadraticCurveTo(-0.13, 0.34, 0.03, 0.52);
    shape.quadraticCurveTo(0.18, 0.68, 0.15, 0.86);
    shape.quadraticCurveTo(0.02, 0.84, -0.12, 0.72);
    shape.quadraticCurveTo(-0.26, 0.53, -0.18, 0.32);
    shape.quadraticCurveTo(-0.14, 0.22, -0.09, 0.15);
    const blade = mesh(new THREE.ShapeGeometry(shape, 14), bladeMaterial);
    blade.name = `cooling-fan-blade-${i + 1}`;
    blade.position.y = 0.0;
    blade.rotation.set(Math.PI / 2, (i * Math.PI * 2) / 5, 0);
    fan.add(blade);

    // Tip accent on outer 20% of blade for crisp visual rotation
    const tipShape = new THREE.Shape();
    tipShape.moveTo(0.06, 0.72);
    tipShape.quadraticCurveTo(0.18, 0.68, 0.15, 0.86);
    tipShape.quadraticCurveTo(0.02, 0.84, -0.12, 0.72);
    tipShape.closePath();
    const tip = mesh(new THREE.ShapeGeometry(tipShape, 10), tipMaterial);
    tip.name = `cooling-fan-tip-${i + 1}`;
    tip.position.y = 0.001;
    tip.rotation.set(Math.PI / 2, (i * Math.PI * 2) / 5, 0);
    fan.add(tip);
  }
  return { root, roofYaw, roofTilt, opaqueRoofMeshes: opaqueRoof.meshes, fan, led, fanIndicator };
}
