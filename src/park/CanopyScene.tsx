import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createEcoCanopyModel } from './createEcoCanopyModel';
import { dampCanopyPose } from './canopyPose';
import { CANOPY_SEAT_RADIUS } from './canopyDimensions';
import './scene.css';

export type SceneProps={heading:number;tilt:number;sunDirection:{x:number;y:number;z:number};fansOn:boolean;night:boolean;occupancy:number;onAngles?:(yaw:number,tilt:number)=>void};
export function CanopyScene({heading,tilt,sunDirection,fansOn,night,occupancy,onAngles}:SceneProps){
 const host=useRef<HTMLDivElement>(null); const live=useRef({heading,tilt,sunDirection,fansOn,night,occupancy,onAngles}); live.current={heading,tilt,sunDirection,fansOn,night,occupancy,onAngles};
 useEffect(()=>{ const el=host.current!; const scene=new THREE.Scene(); const sky=new THREE.Color(0xb9dcea); const nightSky=new THREE.Color(0x07152c); scene.background=sky; scene.fog=new THREE.Fog(0xb9dcea,18,42); const camera=new THREE.PerspectiveCamera(42,1,.1,100); camera.position.set(7,2.9,8); const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,1.6)); renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; el.appendChild(renderer.domElement);
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
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(42,42),new THREE.MeshStandardMaterial({color:0x659d65,roughness:1})); ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);
  const path=new THREE.Mesh(new THREE.RingGeometry(1.7,3.6,64),new THREE.MeshStandardMaterial({color:0xd6cfba,roughness:.88})); path.rotation.x=-Math.PI/2; path.position.y=.006; path.receiveShadow=true; scene.add(path);
  const canopy = createEcoCanopyModel(); scene.add(canopy.root);
  const people=new THREE.Group(); scene.add(people); const peopleMat=[0x8c5740,0x3c6675,0xa27951,0x5b6b4b].map(color=>new THREE.MeshStandardMaterial({color,roughness:.7}));
  for(let i=0;i<8;i++){
    const p=new THREE.Group();
    const body=new THREE.Mesh(new THREE.CylinderGeometry(.105,.14,.48,10),peopleMat[i%4]);
    body.position.y=.72; body.castShadow=true; body.receiveShadow=true; p.add(body);
    const head=new THREE.Mesh(new THREE.SphereGeometry(.11,12,10),new THREE.MeshStandardMaterial({color:0x8d6044}));
    head.position.y=1.05; head.castShadow=true; head.receiveShadow=true; p.add(head);
    const a=i/8*Math.PI*2;
    p.position.set(Math.sin(a)*CANOPY_SEAT_RADIUS,0,Math.cos(a)*CANOPY_SEAT_RADIUS); p.rotation.y=-a; people.add(p);
  }
  const trees=new THREE.Group(); scene.add(trees); for(let i=0;i<14;i++){const a=i/14*Math.PI*2+.2;const r=5+(i%3)*1.4; const tree=new THREE.Group();const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.13,.2,1.8,8),new THREE.MeshStandardMaterial({color:0x73513c}));trunk.position.y=.9;tree.add(trunk);const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(.78+(i%2)*.12,1),new THREE.MeshStandardMaterial({color:i%2?0x426f48:0x5b8b55,roughness:.9}));crown.position.y=2;tree.add(crown);tree.position.set(Math.sin(a)*r,0,Math.cos(a)*r);trees.add(tree)}
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
    const currentPose=dampCanopyPose(canopy,{yaw:currentYaw,tilt:currentTilt},{heading:s.heading,tilt:s.tilt},.016);
    currentYaw=currentPose.yaw;
    currentTilt=currentPose.tilt;
    canopy.fan.rotation.y+=s.fansOn?.32:0;
    people.children.forEach((p,i)=>p.visible=i<s.occupancy);
    s.onAngles?.(THREE.MathUtils.radToDeg(currentYaw),THREE.MathUtils.radToDeg(currentTilt));
    controls.update();
    renderer.render(scene,camera);
  };
  animate();
  return()=>{
    cancelAnimationFrame(raf); observer.disconnect(); renderer.dispose(); el.removeChild(renderer.domElement);
  };
 } ,[]);
 return <div className="canopy-canvas" ref={host}/>;
}
