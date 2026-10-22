# Fixed-canopy shade estimate

## Occupied area

The measured region is provisionally a circle of 2.7 m diameter, centred on the trunk (radius 1.35 m). The project notes describe a roughly 2.7 m circular seating area, and the modeled seat slats have an outer extent close to that diameter. This is a working assumption, not a confirmed occupancy boundary; the radius and fixed world-space centre are centralized in `canopyDimensions.ts` so they can be changed after the team confirms the intended area. The centre stays fixed when the canopy turns or tilts. The 5.6 m canopy diameter is unchanged.

## Roof surfaces used by the ground metric

Only the meshes named `roof-underside` and `roof-dome`, created by `createOpaqueRoofSurfaces`, are included in the ground-area ray test:

- `roof-underside` is the modeled capped cylinder, 0.16 m thick, with a 2.8 m top radius and 2.64 m bottom radius. It has solid top and bottom caps.
- `roof-dome` is the modeled shallow upper hemisphere, scaled to 25% of its sphere height. It meets the top of the underside cylinder.

Both use opaque Three.js standard materials with default opacity 1 and no alpha texture or cutouts. The ray-only material uses `DoubleSide` so sunlight rays can detect an underside hit; this does not change the modeled geometry or make it transparent. The estimator intentionally excludes the solar panels, their rails and cell lines, ribs, rim, LED ring, actuator-like cylinder, fan, trunk, seating, and other objects. In this model the two selected shell meshes form a continuous opaque roof with no modeled openings. This is a geometry/material assumption about the current reconstruction, not confirmation that the physical design has no gaps. Any real roof perforations, translucent material, or panel gaps need measured geometry and a changed model before they can be evaluated.

## Calculation and limits

The primary value is the percentage of evenly spaced ground sample points inside the fixed circle whose ray toward the sun intersects one of those two transformed roof meshes. The default grid spacing is 0.1 m. It is a deterministic area estimate, not an exact analytic area. Refinement tests compare 0.2 m, 0.1 m, and 0.05 m spacing. Coverage is evaluated with the current heading and tilt; below or at the horizon the result is explicitly marked “direct sun unavailable” and its numeric coverage is zero. Positive low solar elevations are not clamped, so their long shadows are evaluated geometrically; grid resolution, atmospheric refraction, terrain, distant obstructions, and shadow lengths beyond the rendered shadow-camera bounds remain limitations.

The selected date and clock time are Malaysian local civil time (MYT, UTC+8). The solar-position function converts that selection to a UTC instant, evaluates the NOAA fractional-year equation-of-time and declination equations, and applies the MYT standard meridian at 120° east plus the selected longitude correction. Its geometric sun vector uses +X east, +Y up, +Z north; azimuth is clockwise from north. The same vector is passed to the Three.js directional light and the ground-ray shade calculation. The calculation does not model atmospheric refraction.

The rendered canopy eases toward new heading and tilt values over animation frames, while the numerical shade result uses the requested values immediately. A small follow-up can use `CanopyScene`'s existing `onAngles` callback to report its eased pose, then recalculate shade at a throttled cadence so the ray test does not run on every animation frame. That synchronization is separate and is not included here.

The secondary person metric retains the existing simplified seated-person sample model. In the original park app it uses the first `occupancy` seats; the dashboard continues to use its previous eight-person default. It is not ground-area coverage and is not a human comfort model.

## Automatic shade search

With adaptive shading enabled, the original park page automatically searches heading values from -90 to +90 degrees in 15-degree steps and tilt values from -30 to +30 degrees in 5-degree steps (169 grid positions). The ±30-degree tilt range is provisional for prototype testing, not an engineering-approved movement range. The search starts on entering adaptive mode and runs again when the sun vector changes by at least 3 degrees. If the starting roof pose is between grid points, that exact pose is added as another candidate. Every candidate calls the same `groundAreaShadeCoverage` function with the same MYT sun vector, occupied circle, opaque roof meshes, and 0.1 m sampling spacing as the displayed ground-area metric. The search yields to the browser after each group of seven positions. Manual mode cancels a pending search and holds the current target pose; adaptive search pauses at night and resumes after daylight returns.

The controller applies a new target only when its estimated ground-area coverage improves by at least 1 percentage point. Smaller gains keep the current pose to avoid needless motion. The displayed adaptive result is the best among the evaluated candidates, not a guarantee of a continuous mathematical maximum. Equal coverage first favours the position closest to the starting pose, then the smaller absolute tilt, then a deterministic numeric order.

The result is the best among the evaluated candidates, not a guarantee of a continuous mathematical maximum. Equal coverage first favours the position closest to the starting pose, then the smaller absolute tilt, then a deterministic numeric order. Less than 100% can be the best achievable within the tested allowed positions because the roof footprint, sun direction, allowed ranges, and discrete search spacing constrain the shadow. Users can keep manual control or apply the recommendation; applying it switches heading and tilt to manual mode.
