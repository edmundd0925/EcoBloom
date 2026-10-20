# EcoCanopy reconstruction notes

The supplied design sheet shows an approximately 4.5 m circular solar roof, a 0.2 m roof depth, a 3 m total height, and a roughly 2.7 m circular seating area. The current roof is 5.6 m across, providing a moderate additional overhang for seating shade. The model remains an illustrative reconstruction rather than structural documentation.

`createEcoCanopyModel` keeps the base, pillar, bearing, and seating below the animation hierarchy. The roof assembly has two explicit pivots:

- `roof-yaw-pivot` rotates about world Y for heading.
- `roof-tilt-pivot`, nested inside it, rotates about local X for tilt.

The PV dome, two photovoltaic modules, trim, underside, LED ring, actuator, ribs, and fan are children of the tilt pivot. The seating and pillar are siblings of the yaw pivot, so roof motion cannot move them. The canopy stays open-sided; shade comes from the roof alone.

The simulator uses +X east, +Y up, and +Z north. Sun azimuth is measured clockwise from north. One sun vector drives the Three.js directional light, the transformed roof normal used for generation, and person-height ray checks against the roof disk. At low sun angles, direct light can pass beneath an open-sided canopy; the shade estimate reflects that instead of assuming a wall is deployed.

The `img2threejs` intake and assessment utilities ran with Python 3.14.6. Its strict starter-spec validation did not pass because the supplied multi-view design sheet needs a completed object-specific material and component assessment. The app therefore uses the documented procedural TypeScript fallback above; it does not present the model as a passed `img2threejs` reconstruction.
