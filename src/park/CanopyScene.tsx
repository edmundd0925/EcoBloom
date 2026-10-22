import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createEcoCanopyModel } from './createEcoCanopyModel';
import { dampCanopyPose } from './canopyPose';
import { CANOPY_SEAT_RADIUS } from './canopyDimensions';
import './scene.css';

function createProceduralTrees(): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    const r = 5 + (i % 3) * 1.4;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.2, 1.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x73513c })
    );
    trunk.position.y = 0.9;
    tree.add(trunk);
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.78 + (i % 2) * 0.12, 1),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0x426f48 : 0x5b8b55, roughness: 0.9 })
    );
    crown.position.y = 2;
    tree.add(crown);
    tree.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
    group.add(tree);
  }
  return group;
}

/**
 * 7 surrounding linden tree placements around the park pavilion.
 */
const TREE_CONFIGS = [
  { x: -4.5, z: 2.0, scale: 0.48, rot: 0.8 },
  { x: -4.8, z: -2.8, scale: 0.44, rot: 2.1 },
  { x: -1.2, z: -6.2, scale: 0.52, rot: 4.2 },
  { x: 3.8, z: -4.6, scale: 0.46, rot: 1.3 },
  { x: 6.5, z: -1.5, scale: 0.50, rot: 3.6 },
  { x: 5.8, z: 3.8, scale: 0.42, rot: 5.1 },
  { x: -1.8, z: 5.8, scale: 0.47, rot: 0.4 },
];

/**
 * Grass density, scale, and placement boundaries.
 * Adjust these values to customize the park landscape:
 * - count: Total number of grass clumps distributed.
 * - baseScale: Overall size multiplier (1.0 = ~22cm, 1.5 = ~33cm, 2.0 = ~44cm).
 * - scaleVariation: Random scale variance (+/-) for organic variety.
 * - minRadius: Inner boundary (kept > 3.6m to clear the circular stone walkway).
 * - maxRadius: Outer boundary on the surrounding lawn (within 21m ground plane).
 */
export const GRASS_CONFIG = {
  count: 52,
  baseScale: 1.5,
  scaleVariation: 0.45,
  minRadius: 3.85,
  maxRadius: 14.0,
};

function generateGrassPositions(
  count: number,
  baseScale: number,
  scaleVariation: number,
  minRadius: number,
  maxRadius: number,
  treePositions: Array<{ x: number; z: number }>
) {
  let s = 1337;
  const rng = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };

  const instances: Array<{ x: number; z: number; scale: number; rot: number }> = [];

  // 1. Path perimeter tufts: softly edging the curved boundary of the stone walkway
  const pathTuftCount = Math.floor(count * 0.4);
  for (let i = 0; i < pathTuftCount; i++) {
    const angle = (i / pathTuftCount) * Math.PI * 2 + (rng() - 0.5) * 0.35;
    const radius = minRadius + rng() * 1.35;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    const scale = Math.max(0.6, baseScale + (rng() - 0.5) * scaleVariation);
    const rot = rng() * Math.PI * 2;
    instances.push({ x, z, scale, rot });
  }

  // 2. Tree undergrowth: natural grass clusters around the bases of the linden trees
  treePositions.forEach((tp) => {
    const clusterCount = 2 + Math.floor(rng() * 2);
    for (let k = 0; k < clusterCount; k++) {
      const a = rng() * Math.PI * 2;
      const dist = 0.45 + rng() * 1.1;
      const x = tp.x + Math.sin(a) * dist;
      const z = tp.z + Math.cos(a) * dist;
      const r = Math.hypot(x, z);
      if (r >= minRadius) {
        const scale = Math.max(0.6, baseScale * 1.05 + (rng() - 0.5) * scaleVariation);
        const rot = rng() * Math.PI * 2;
        instances.push({ x, z, scale, rot });
      }
    }
  });

  // 3. Meadow lawn scatter: natural random tufts across the wider park lawn
  let attempts = 0;
  while (instances.length < count && attempts < count * 8) {
    attempts++;
    const a = rng() * Math.PI * 2;
    const r = minRadius + 1.2 + rng() * (maxRadius - minRadius - 1.2);
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const tooCloseToTree = treePositions.some((tp) => Math.hypot(x - tp.x, z - tp.z) < 0.45);
    if (!tooCloseToTree) {
      const scale = Math.max(0.6, baseScale + (rng() - 0.5) * scaleVariation);
      const rot = rng() * Math.PI * 2;
      instances.push({ x, z, scale, rot });
    }
  }

  return instances;
}

function createProceduralPeople(): THREE.Group {
  const group = new THREE.Group();
  const peopleMat = [0x8c5740, 0x3c6675, 0xa27951, 0x5b6b4b].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
  );
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.14, 0.48, 10), peopleMat[i % 4]);
    body.position.y = 0.72;
    body.castShadow = true;
    body.receiveShadow = true;
    p.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), new THREE.MeshStandardMaterial({ color: 0x8d6044 }));
    head.position.y = 1.05;
    head.castShadow = true;
    head.receiveShadow = true;
    p.add(head);
    const a = (i / 8) * Math.PI * 2;
    p.position.set(Math.sin(a) * CANOPY_SEAT_RADIUS, 0, Math.cos(a) * CANOPY_SEAT_RADIUS);
    p.rotation.y = a;
    group.add(p);
  }
  return group;
}

export type SceneProps={heading:number;tilt:number;sunDirection:{x:number;y:number;z:number};fansOn:boolean;night:boolean;occupancy:number;onAngles?:(yaw:number,tilt:number)=>void};
export function CanopyScene({heading,tilt,sunDirection,fansOn,night,occupancy,onAngles}:SceneProps){
 const host=useRef<HTMLDivElement>(null); const live=useRef({heading,tilt,sunDirection,fansOn,night,occupancy,onAngles}); live.current={heading,tilt,sunDirection,fansOn,night,occupancy,onAngles};
 useEffect(()=>{
  let disposed = false;
  const el=host.current!; const scene=new THREE.Scene(); const sky=new THREE.Color(0xb9dcea); const nightSky=new THREE.Color(0x07152c); scene.background=sky; scene.fog=new THREE.Fog(0xb9dcea,18,42); const camera=new THREE.PerspectiveCamera(42,1,.1,100); camera.position.set(7,2.9,8); const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,1.6)); renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; el.appendChild(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement); controls.target.set(0,1.3,0); controls.enableDamping=true; controls.minDistance=4.5; controls.maxDistance=15; controls.maxPolarAngle=Math.PI*.48;
  scene.add(new THREE.HemisphereLight(0xd8f0ff,0x365c35,1.45));
  const key=new THREE.DirectionalLight(0xffefc5,2.8);
  key.castShadow=true;
  key.target.position.set(0,1.25,0);
  key.shadow.mapSize.set(2048,2048);
  key.shadow.camera.left=-10; key.shadow.camera.right=10;
  key.shadow.camera.top=10; key.shadow.camera.bottom=-10;
  key.shadow.camera.near=.1; key.shadow.camera.far=32;
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias=-.00015;
  key.shadow.normalBias=.02;
  key.shadow.radius=2;
  scene.add(key.target,key);
  const underLight = new THREE.PointLight(0xfff3df, 1.1, 7.0); underLight.position.set(0, 1.85, 0); scene.add(underLight);
  const airflowLight = new THREE.PointLight(0x52e3c2, 0, 5.0); airflowLight.position.set(0, 2.2, 0); scene.add(airflowLight);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(42,42),new THREE.MeshStandardMaterial({color:0x659d65,roughness:1})); ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);
  const path=new THREE.Mesh(new THREE.RingGeometry(1.7,3.6,64),new THREE.MeshStandardMaterial({color:0xd6cfba,roughness:.88})); path.rotation.x=-Math.PI/2; path.position.y=.006; path.receiveShadow=true; scene.add(path);
  const canopy = createEcoCanopyModel(); scene.add(canopy.root);
  const people = new THREE.Group();
  scene.add(people);
  const fallbackPeople = createProceduralPeople();
  while (fallbackPeople.children.length > 0) {
    people.add(fallbackPeople.children[0]);
  }

  const trees=new THREE.Group(); scene.add(trees);
  const fallbackTrees = createProceduralTrees();
  trees.add(fallbackTrees);

  const loader = new GLTFLoader();
  const treeModelUrl = `${import.meta.env.BASE_URL}models/linden-detailed.glb`;
  loader.load(
    treeModelUrl,
    (gltf) => {
      if (disposed) return;
      const baseModel = gltf.scene;
      baseModel.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      trees.clear();
      TREE_CONFIGS.forEach((cfg, idx) => {
        const tree = idx === 0 ? baseModel : baseModel.clone(true);
        tree.scale.set(cfg.scale, cfg.scale, cfg.scale);
        tree.position.set(cfg.x, 0, cfg.z);
        tree.rotation.y = cfg.rot;
        trees.add(tree);
      });
    },
    undefined,
    (error) => {
      console.warn('Failed to load /models/linden-detailed.glb, retaining procedural tree fallback:', error);
    }
  );

  const personModelUrl = `${import.meta.env.BASE_URL}models/seated-lean-forward.glb`;
  loader.load(
    personModelUrl,
    (gltf) => {
      if (disposed) return;
      const basePerson = gltf.scene;
      basePerson.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      people.clear();
      for (let i = 0; i < 8; i++) {
        const person = i === 0 ? basePerson : basePerson.clone(true);
        const a = (i / 8) * Math.PI * 2;
        person.scale.set(0.92, 0.92, 0.92);
        person.position.set(Math.sin(a) * CANOPY_SEAT_RADIUS, 0, Math.cos(a) * CANOPY_SEAT_RADIUS);
        person.rotation.y = a;
        person.visible = i < live.current.occupancy;
        people.add(person);
      }
    },
    undefined,
    (error) => {
      console.warn('Failed to load /models/seated-lean-forward.glb, retaining procedural people fallback:', error);
    }
  );

  const grassGroup = new THREE.Group();
  scene.add(grassGroup);

  const grassModelUrl = `${import.meta.env.BASE_URL}models/grass.glb`;
  loader.load(
    grassModelUrl,
    (gltf) => {
      if (disposed) return;
      const baseGrass = gltf.scene;
      baseGrass.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.receiveShadow = true;
          child.castShadow = false;
        }
      });

      const positions = generateGrassPositions(
        GRASS_CONFIG.count,
        GRASS_CONFIG.baseScale,
        GRASS_CONFIG.scaleVariation,
        GRASS_CONFIG.minRadius,
        GRASS_CONFIG.maxRadius,
        TREE_CONFIGS
      );

      positions.forEach((cfg, idx) => {
        const grass = idx === 0 ? baseGrass : baseGrass.clone(true);
        grass.scale.set(cfg.scale, cfg.scale, cfg.scale);
        grass.position.set(cfg.x, 0, cfg.z);
        grass.rotation.y = cfg.rot;
        grassGroup.add(grass);
      });
    },
    undefined,
    (error) => {
      console.warn('Failed to load /models/grass.glb:', error);
    }
  );

  let raf=0, currentYaw=0,currentTilt=0; const resize=()=>{const w=el.clientWidth,h=el.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false)}; const observer=new ResizeObserver(resize);observer.observe(el);resize();
  const animate=()=>{
    raf=requestAnimationFrame(animate);
    const s=live.current;
    const direction=new THREE.Vector3(s.sunDirection.x,s.sunDirection.y,s.sunDirection.z);
    key.position.copy(direction).multiplyScalar(12).add(key.target.position);
    key.intensity=s.night?.18:2.8;
    // A small daylight threshold controls the night presentation, not whether
    // direct sunlight exists. Keep visible shadows enabled until the sun is
    // actually at or below the horizon, matching the numeric shade status.
    key.castShadow=direction.y>0;

    scene.background=s.night?nightSky:sky;
    scene.fog!.color.copy(s.night?nightSky:sky);
    canopy.led.material.emissiveIntensity=s.night?2.6:0;
    if (canopy.fanIndicator) {
      canopy.fanIndicator.material.emissiveIntensity = s.fansOn ? 3.0 : 0;
    }
    airflowLight.intensity = s.fansOn ? 1.6 : 0;
    const currentPose=dampCanopyPose(canopy,{yaw:currentYaw,tilt:currentTilt},{heading:s.heading,tilt:s.tilt},.016);
    currentYaw=currentPose.yaw;
    currentTilt=currentPose.tilt;
    canopy.fan.rotation.y+=s.fansOn?.38:0;
    people.children.forEach((p,i)=>p.visible=i<s.occupancy);
    s.onAngles?.(THREE.MathUtils.radToDeg(currentYaw),THREE.MathUtils.radToDeg(currentTilt));
    controls.update();
    renderer.render(scene,camera);
  };
  animate();
  return()=>{
    disposed = true;
    cancelAnimationFrame(raf); observer.disconnect(); renderer.dispose(); el.removeChild(renderer.domElement);
  };
 } ,[]);
 return <div className="canopy-canvas" ref={host}/>;
}
