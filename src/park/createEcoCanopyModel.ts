import * as THREE from 'three';
import {
  CANOPY_ROOF_PIVOT_HEIGHT,
  CANOPY_ROOF_RADIUS,
  CANOPY_ROOF_UNDERSIDE_OFFSET,
  CANOPY_SEAT_RADIUS,
} from './canopyDimensions';

export type CanopyModel = {
  root: THREE.Group;
  roofYaw: THREE.Group;
  roofTilt: THREE.Group;
  fan: THREE.Group;
  led: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
};

const metal = (color: number, roughness = .42) => new THREE.MeshStandardMaterial({ color, metalness: .68, roughness });
const mesh = <T extends THREE.BufferGeometry, M extends THREE.Material>(geometry: T, material: M) => {
  const item = new THREE.Mesh(geometry, material); item.castShadow = true; item.receiveShadow = true; return item;
};

/** Inferred from the supplied canopy sheet. Units are illustrative metres; +X east, +Y up, +Z north. */
export function createEcoCanopyModel(): CanopyModel {
  const root = new THREE.Group(); root.name = 'EcoCanopy';
  const wood = new THREE.MeshStandardMaterial({ color: 0x99603b, roughness: .68 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x263d4a, metalness: .3, roughness: .5 });
  const warm = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xa66b1b, emissiveIntensity: 0, roughness: .4 });
  const pillar = mesh(new THREE.CylinderGeometry(.19, .24, 2.26, 32), metal(0xaebbc2, .46)); pillar.position.y = 1.13; root.add(pillar);
  const base = mesh(new THREE.CylinderGeometry(1.38, 1.48, .18, 48), metal(0x5c6667,.45)); base.position.y=.09; root.add(base);
  const seat = new THREE.Group(); seat.name='seating';
  for(let i=0;i<26;i++){ const a=i/26*Math.PI*2; const slat=mesh(new THREE.BoxGeometry(.17,.12,.62),wood); slat.position.set(Math.sin(a)*CANOPY_SEAT_RADIUS,.42,Math.cos(a)*CANOPY_SEAT_RADIUS); slat.rotation.y=-a; seat.add(slat); }
  const seatRing=mesh(new THREE.TorusGeometry(1.05,.05,10,48),metal(0x59666d,.5)); seatRing.position.y=.33; seatRing.rotation.x=Math.PI/2; seat.add(seatRing); root.add(seat);
  const bearing = mesh(new THREE.CylinderGeometry(.36,.36,.14,32),metal(0x3d4547,.22)); bearing.position.y=2.28; root.add(bearing);
  const roofYaw=new THREE.Group(); roofYaw.name='roof-yaw-pivot'; roofYaw.position.y=CANOPY_ROOF_PIVOT_HEIGHT; root.add(roofYaw);
  const roofTilt=new THREE.Group(); roofTilt.name='roof-tilt-pivot'; roofYaw.add(roofTilt);
  const actuator=mesh(new THREE.CylinderGeometry(.055,.055,.62,12),metal(0x787f7d,.32)); actuator.position.set(.32,-.22,0); actuator.rotation.z=-.62; roofTilt.add(actuator);
  const underside=mesh(new THREE.CylinderGeometry(CANOPY_ROOF_RADIUS,CANOPY_ROOF_RADIUS-.16,.16,64),metal(0x343f45,.68)); underside.position.y=CANOPY_ROOF_UNDERSIDE_OFFSET; roofTilt.add(underside);
  const dome=mesh(
    new THREE.SphereGeometry(CANOPY_ROOF_RADIUS,64,24,0,Math.PI*2,0,Math.PI/2),dark); 
    dome.scale.y=.25; 
    dome.position.y=.1; 
    roofTilt.add(dome);
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
  for(let i=0;i<12;i++){ const a=i/12*Math.PI*2; const ribLength=CANOPY_ROOF_RADIUS-.1; const rib=mesh(new THREE.BoxGeometry(.05,.045,ribLength),metal(0x59666d,.52)); rib.position.set(Math.sin(a)*ribLength/2,-.08,Math.cos(a)*ribLength/2); rib.rotation.y=a; roofTilt.add(rib); }
  const led=mesh(new THREE.TorusGeometry(1.54,.028,10,64),warm); led.rotation.x=Math.PI/2; led.position.y=-.1; roofTilt.add(led);
  const fan = new THREE.Group();
  fan.name = 'cooling-fan';
  fan.position.set(0, -0.24, 0);
  roofTilt.add(fan);

  // A light housing and separated radial blades make the rotor legible below the roof.
  const fanHousing = mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 0.12, 40),
    metal(0xd8e0e4, 0.46)
  );
  fan.add(fanHousing);

  // Contrasting dark green centre hub
  const fanHub = mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.17, 24),
    metal(0x15966a, 0.48)
  );
  fanHub.position.y = -0.01;
  fan.add(fanHub);

  // Five swept paddle blades extend from the hub without overlapping.
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: 0x45545c,
    metalness: 0.62,
    roughness: 0.48,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 5; i++) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.09, 0.13);
    shape.quadraticCurveTo(-0.12, 0.32, 0.03, 0.49);
    shape.quadraticCurveTo(0.17, 0.65, 0.14, 0.82);
    shape.quadraticCurveTo(0.02, 0.80, -0.11, 0.68);
    shape.quadraticCurveTo(-0.25, 0.51, -0.17, 0.30);
    shape.quadraticCurveTo(-0.14, 0.20, -0.09, 0.13);
    const blade = mesh(new THREE.ShapeGeometry(shape, 12), bladeMaterial);
    blade.position.y = -0.08;
    blade.rotation.set(Math.PI / 2, (i * Math.PI * 2) / 5, 0);
    fan.add(blade);
  }
  return { root, roofYaw, roofTilt, fan, led };
}
