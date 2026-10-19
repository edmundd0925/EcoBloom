import * as THREE from 'three';

export type CanopyModel = {
  root: THREE.Group;
  roofYaw: THREE.Group;
  roofTilt: THREE.Group;
  fan: THREE.Group;
  led: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
};

const metal = (color: number, roughness = .28) => new THREE.MeshStandardMaterial({ color, metalness: .82, roughness });
const mesh = <T extends THREE.BufferGeometry, M extends THREE.Material>(geometry: T, material: M) => {
  const item = new THREE.Mesh(geometry, material); item.castShadow = true; item.receiveShadow = true; return item;
};

/** Inferred from the supplied canopy sheet. Units are illustrative metres; +X east, +Y up, +Z north. */
export function createEcoCanopyModel(): CanopyModel {
  const root = new THREE.Group(); root.name = 'EcoCanopy';
  const wood = new THREE.MeshStandardMaterial({ color: 0x8c512b, roughness: .48 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x071a38, metalness: .35, roughness: .18 });
  const warm = new THREE.MeshStandardMaterial({ color: 0xffc46b, emissive: 0x9f5c13, emissiveIntensity: 0, roughness: .35 });
  const pillar = mesh(new THREE.CylinderGeometry(.19, .24, 2.26, 32), metal(0xb8bfc0)); pillar.position.y = 1.13; root.add(pillar);
  const base = mesh(new THREE.CylinderGeometry(1.38, 1.48, .18, 48), metal(0x5c6667,.45)); base.position.y=.09; root.add(base);
  const seat = new THREE.Group(); seat.name='seating';
  for(let i=0;i<26;i++){ const a=i/26*Math.PI*2; const slat=mesh(new THREE.BoxGeometry(.17,.12,.62),wood); slat.position.set(Math.sin(a)*1.03,.42,Math.cos(a)*1.03); slat.rotation.y=-a; seat.add(slat); }
  const seatRing=mesh(new THREE.TorusGeometry(1.05,.05,10,48),metal(0x4e5758,.42)); seatRing.position.y=.33; seatRing.rotation.x=Math.PI/2; seat.add(seatRing); root.add(seat);
  const bearing = mesh(new THREE.CylinderGeometry(.36,.36,.14,32),metal(0x3d4547,.22)); bearing.position.y=2.28; root.add(bearing);
  const roofYaw=new THREE.Group(); roofYaw.name='roof-yaw-pivot'; roofYaw.position.y=2.35; root.add(roofYaw);
  const roofTilt=new THREE.Group(); roofTilt.name='roof-tilt-pivot'; roofYaw.add(roofTilt);
  const actuator=mesh(new THREE.CylinderGeometry(.055,.055,.62,12),metal(0x787f7d,.32)); actuator.position.set(.32,-.22,0); actuator.rotation.z=-.62; roofTilt.add(actuator);
  const underside=mesh(new THREE.CylinderGeometry(2.02,1.86,.16,64),metal(0xc8c4b7,.34)); underside.position.y=.02; roofTilt.add(underside);
  const dome=mesh(new THREE.SphereGeometry(2.02,64,24,0,Math.PI*2,0,Math.PI/2),dark); dome.scale.y=.25; dome.position.y=.1; roofTilt.add(dome);
  const rim=mesh(new THREE.TorusGeometry(1.99,.075,12,64),metal(0xd7d4ca,.22)); rim.rotation.x=Math.PI/2; rim.position.y=.03; roofTilt.add(rim);
  for(let i=0;i<12;i++){ const a=i/12*Math.PI*2; const rib=mesh(new THREE.BoxGeometry(.035,.035,1.75),metal(0x858b89,.34)); rib.position.set(Math.sin(a)*.82,-.08,Math.cos(a)*.82); rib.rotation.y=-a; roofTilt.add(rib); }
  const led=mesh(new THREE.TorusGeometry(1.54,.028,10,64),warm); led.rotation.x=Math.PI/2; led.position.y=-.1; roofTilt.add(led);
  const fan=new THREE.Group(); fan.name='cooling-fan'; fan.position.y=-.21; roofTilt.add(fan);
  fan.add(mesh(new THREE.CylinderGeometry(.22,.22,.08,24),metal(0x30383a,.22)));
  for(let i=0;i<5;i++){ const blade=mesh(new THREE.BoxGeometry(.12,.018,.34),metal(0x6b7472,.3)); blade.position.z=.22; blade.rotation.y=i*Math.PI*2/5+.35; fan.add(blade); }
  return { root, roofYaw, roofTilt, fan, led };
}
