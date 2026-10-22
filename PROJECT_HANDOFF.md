# EcoBloom Project Handoff

## Purpose and scope

This document describes the repository as it exists now, based on its source and configuration. It is intended to help a new developer or Google Antigravity continue the project without mistaking its demonstration behavior for a connected physical system.

## 1. Project overview

EcoBloom is a browser-based smart solar park / EcoCanopy prototype. It visualizes a park canopy in 3D and offers a unified client-side simulator interface:

- **Park simulator** at `/` (`src/App.tsx`): simulated time, date and location, sun position, environment controls, fast responsive canopy sun-tracking and adaptive ground-shade optimization, cooling controls, occupancy, energy charts, battery history, and simulated activity events in one compact panel.

`src/main.tsx` renders `App` directly.

### Implementation status

The repository contains a functioning frontend prototype and unit tests for solar, shade, optimization, and helper behavior. It has no application server, API layer, database, persistence, login, sensor connection, or physical control integration in the inspected source/configuration. Numerical values such as power demand, battery capacity/loss, shade thresholds, and cooling threshold are demonstration assumptions, not validated engineering specifications.

No build, tests, lint, browser run, deployment, dependency installation, or hardware integration was performed for this handoff. The existence of test files demonstrates test coverage in source, not that the current checkout passes those tests.

## 2. Technologies and dependencies

- **Language/UI:** TypeScript, TSX, React 18, React DOM 18.
- **Build/dev server:** Vite 6 with `@vitejs/plugin-react`.
- **3D:** Three.js, including `OrbitControls`; the canopy model is constructed procedurally in TypeScript.
- **Charts/icons:** Recharts and Lucide React.
- **CSS tooling:** Tailwind CSS 3, PostCSS, Autoprefixer are configured. The inspected UI also uses substantial hand-authored CSS.
- **TypeScript:** approximately 5.6, strict mode enabled for app and Vite config.
- **Tests:** Node's built-in test runner (`node:test`) and assertions. The test command uses `--experimental-strip-types` to import TypeScript directly.
- **Three.js type declarations:** `@types/three` is pinned to the local path `file:vendor/three-types`; preserve this local dependency unless there is a deliberate, verified replacement plan.

Exact dependency versions/ranges and scripts are in `package.json`; the lockfile is `package-lock.json`. No `engines` field is declared there, so a required Node version cannot be verified from package metadata. The current source uses browser APIs including WebGL, `ResizeObserver`, workers, and ES modules.

## 3. Repository structure and responsibilities

| Path | Responsibility |
|---|---|
| `index.html` | Vite HTML shell, root mount point, page title, and Google Fonts stylesheet links (DM Sans and Manrope). |
| `src/main.tsx` | React entry point; query-string dashboard selection; view-switch navigation; imports global/dashboard navigation styles. |
| `src/App.tsx` | Original park simulator UI and its state, controls, playback, adaptive shade search orchestration, and chart/event presentation. This is a large, mostly single-file React component. |
| `src/styles.css` | Original dashboard and global styling. |
| `src/simulation.ts` | Shared/legacy solar position, MYT conversion, daylight, orientation, illustrative solar output, person-sample shade estimate, exact ground shade wrapper, and a result cache helper. |
| `src/park/CanopyScene.tsx` | Three.js scene lifecycle, camera/OrbitControls, park ground/path, canopy, people/trees, lighting, animation, resize handling, and WebGL render loop. |
| `src/park/createEcoCanopyModel.ts` | Procedural canopy mesh assembly, including the roof, PV-like components, fan, LEDs, and structural parts. |
| `src/park/canopyDimensions.ts` | Shared model dimensions and provisional roof/occupied-region limits. |
| `src/park/canopyPose.ts` | Canopy pose interpolation/damping helper. |
| `src/park/groundShadeCoverage.ts` | Sample-grid and raycast estimate of direct-sun ground-area shade against supplied opaque roof meshes. |
| `src/park/shadeOptimization.ts` | Candidate pose grid, tie-break rules, and minimum-improvement selection for shade optimization. |
| `src/park/shadeOptimization.worker.ts` | Worker-side candidate evaluation using ground-area shade calculations; reports progress/completion/errors. |
| `src/park/adaptiveShade.ts` | Adaptive search scheduling, result validity, cache, time-edit handling, and control-mode helper logic. |
| `src/park/scene.css` | 3D scene host/canvas styling. |
| `src/park/SHADE-COVERAGE.md` | Notes explaining shade metrics and adaptive shade behavior/limitations. |
| `src/park/RECONSTRUCTION.md` | Procedural model construction and reconstruction caveats. |
| `tests/solarPosition.test.mjs` | Solar position, date/time/MYT conversion, day/night, and orientation tests. |
| `tests/groundShadeCoverage.test.mjs` | Ground shade raycast/sample coverage tests. |
| `tests/shadeOptimization.test.mjs` | Candidate selection and adaptive search helper tests. |
| `vendor/three-types/` | Vendored/local Three.js declarations referenced by `package.json`. |
| `vite.config.ts` | Vite config with React plugin. |
| `tsconfig*.json` | TypeScript project references and strict app/node settings. |
| `tailwind.config.js`, `postcss.config.js` | Tailwind/PostCSS configuration. |
| `START-HERE.md`, `FULL-PROJECT-README.md` | Quickstart setup and run instructions. |
| `start.mjs`, `start.sh` | Cross-platform launcher script (Node.js ESM) and shell wrapper for Mac, Windows, and Linux; checks dependencies and starts Vite. |
| `.img2threejs/`, `.taste-skill/` | Project-associated model assessment/intake and design-direction artifacts; not runtime app modules. |

### Entry point

Vite serves `index.html`, which imports `/src/main.tsx`. React mounts `<App />` directly to `#root`.

## 4. System architecture

### Frontend and simulation flow

This is a Vite single-page frontend. There is no backend/frontend boundary in the code: each dashboard stores state in React and computes displayed outputs locally. No `fetch`, Axios, API route definitions, server framework, database client/ORM, schema/migrations, authentication provider, or credential configuration was found in the inspected source/configuration. No request/response contract or user data persistence mechanism is present.

The original simulator computes sun location using NOAA-style fractional-year/equation-of-time and declination equations. It treats UI date/minute as Malaysian civil time (MYT, UTC+8), defaults location to Kuala Lumpur coordinates, and defines world axes as +X east, +Y up, +Z north with azimuth clockwise from north. Its canopy shade estimate raycasts from a regular circular ground grid toward the sun against the opaque roof meshes. Adaptive shade search evaluates a discrete heading/tilt candidate set in a module worker and uses caches/scheduling helpers.

The Person 3 dashboard calls `simulatorAdapter.ts`, which reuses shared solar/daylight, legacy seated-person shade, and solar output helpers while applying its own illustrative operating, fan, battery, and demand rules. Its energy profile is a calculated forecast-style profile, not historical data. Playback advances its simulated clock and estimated battery state in intervals; dragging the time slider does not accrue skipped battery time.

The 3D scene receives canopy pose, sun direction, fan/night flags, and occupancy as props. `CanopyScene.tsx` creates/disposes a Three.js WebGL renderer and scene, animates the roof/fan, displays synthetic people and trees, and uses the sun direction for lighting and shadows. No hardware telemetry reaches this scene.

### API, authentication, and persistence

- API routes: none found.
- HTTP request/response format: none found in app source.
- Authentication/authorization: none found.
- Database schema/models/relationships: none found.
- Persistent storage: no localStorage/sessionStorage/database usage found. Simulator state is in-memory React state and reset/reload behavior is local to the page.

### External services/integrations

- Google Fonts are loaded through the two Google Fonts links in `index.html`; availability requires network access to those font hosts. The app does not otherwise show an external service integration in inspected code.
- The original simulator starts a module Web Worker for shade candidate evaluation.
- Three.js uses browser WebGL and `OrbitControls` for the interactive model.
- No cloud, deployment, telemetry, weather, map, sensor, or hardware API integration is configured in the inspected project files.

## 5. Current functionality, unfinished areas, and limitations

### Implemented in source

- Two query-selected React dashboards and a persistent switch between them.
- Interactive procedural 3D park/canopy, camera orbit controls, changing sun light, roof movement, fans, LED/night styling, and occupancy-dependent synthetic people.
- Date/time/location-based solar position model and daylight estimates.
- Original dashboard controls and playback with charts/events.
- Original dashboard adaptive ground-shade search: discrete candidates, worker evaluation, progress/error state, caching, stale-search checks, and minimum improvement threshold.
- Person 3 quick scenarios, environment sliders, operating/fan modes, output metrics, daily estimate chart, and playback battery history.
- Three Node test files cover simulation/helpers and shade coverage/optimization behavior.

### Partial/demo-only

- Person 3 adapter explicitly labels decision and energy functions as temporary demonstration logic. Wind threshold is 12 m/s and battery capacity is assumed to be 48 kWh; power/demand/efficiency values are embedded assumptions.
- Person 3 shade metric is the simplified seated-person sample estimate (up to eight seats), not the original dashboard's sampled ground-area estimate. The two similarly named shade outputs are therefore not equivalent.
- The 3D canopy is a procedural illustrative reconstruction. `RECONSTRUCTION.md` says it is not structural documentation and notes that physical roof gaps/transparency are not represented by the opaque shell used for shade calculations.
- Occupancy, sunlight, temperature, wind, battery, and operational state are user-controlled demo inputs, not sensors.
- Original dashboard event strings and status language (for example, “sensors connected”/“ONLINE”) are UI presentation and not evidence of a connected device.
- Battery values and energy graphs are computed demo values; they are not measured system performance.

### Missing or not verified

- Production backend, API, database, authentication, persistence, telemetry, real-time device communication, deployment pipeline, and validated hardware control/safety behavior are not present in the inspected code/configuration.
- No lint script or lint configuration was found in `package.json` or the listed project files. No explicit formatter, browser automation, or component test framework is configured there.
- Tests/build were not run, so current pass/fail status is unknown. Browser rendering and deployment behavior were not checked.
- Whether a compatible Node/npm installation and installed `node_modules` are available in a future Antigravity environment is unknown. No engine version is declared.
- No `.env` template or app environment variable usage was found. `.gitignore` ignores `.env.local`, but no required environment variables are defined by inspected source.
- `START-HERE.md` and `FULL-PROJECT-README.md` mention an archive/ZIP, prebuilt `dist`, and Windows setup context. Those statements may be historical or package-specific; this handoff does not verify that referenced archive states match the current checkout.
- Tests cover helper/model logic; no end-to-end browser or physical-device tests were found.

## 6. Development workflow and setup

Commands below are derived from `package.json`; they are documented for the next developer but were **not run** as part of this read-only inspection.

1. Install a Node.js/npm version compatible with Vite 6 and the lockfile. The project does not declare an exact Node version, so choose/confirm one with the team before standardizing CI.
2. From the directory containing `package.json`, install dependencies with `npm install` (or `npm ci` for a lockfile-based clean install where appropriate). This will change dependency files/folders; it was not done during this inspection.
3. Start the development server with `npm run dev`; use the URL Vite prints (usually `http://localhost:5173/`).
4. Build/type-check with `npm run build` (`tsc -b && vite build`).
5. Run unit tests with `npm test` (Node test runner plus TypeScript strip-types flag).
6. Preview an already generated production build with `npm run preview`.

No lint command is declared. No environment variables are required by the inspected app source; the font stylesheet links are external network requests from the browser. For offline operation, font behavior would need to be intentionally addressed. Use `npm start`, `npm run dev`, or `node start.mjs` for cross-platform startup.

## 7. Implementation constraints and compatibility

- Preserve both dashboard paths and the query-string selection behavior unless the user's new requirements explicitly replace them.
- `src/App.tsx` and `src/park/` contain the original simulator and the more advanced worker-based ground-shade logic. Avoid broad rewrites of these modules; changes can affect adaptive search, simulation timing, sun axes, geometry, and shade metrics.
- Keep the solar coordinate/time convention consistent: MYT is UTC+8; +X east, +Y up, +Z north; azimuth is clockwise from north.
- Keep React 18, TypeScript strict settings, Vite module-worker support, and the local `vendor/three-types` dependency in mind when changing build/runtime architecture.
- Do not present any demo values or status labels as real sensor/hardware data. Real control or safety features require explicit requirements, validated models, and an agreed hardware/API boundary.
- Preserve tests and update/add coverage when behavior changes. Report actual commands/results; do not imply test success without running the command.
- Keep UI and simulation responsibilities appropriately scoped. The current Person 3 adapter is an intentional seam for later validated logic; verify the actual source before changing the interface it exports.
- Avoid touching archive notes, generated outputs, vendor declarations, or unrelated files unless the new requirement needs it.

## 8. Ready-to-use Google Antigravity prompt

Copy the prompt below into Antigravity after opening this project folder:

```text
You are taking over the existing EcoBloom project. Start by inspecting the actual repository and reading PROJECT_HANDOFF.md. Verify important handoff details directly against package.json, the entry point, the dashboard components, simulation modules, tests, and relevant configuration. Treat source/configuration as authoritative if the handoff and repository differ, and report any discrepancy.

This is currently a client-side React/Vite prototype with two query-selected dashboards and illustrative simulation behavior. Preserve the existing architecture and working functionality unless my later requirements explicitly call for a change. In particular, understand the original simulator in src/App.tsx and src/park/, the Person 3 dashboard in src/person3/, the shared simulation in src/simulation.ts, the worker flow, and existing tests before proposing changes. Do not assume a backend, API, database, authentication, sensor feed, or real hardware integration exists.

IMPORTANT: For now, perform inspection and planning only. Do not implement, edit, delete, move, overwrite, generate, or reformat project files. Do not install dependencies or run commands that modify the project. Wait for my additional requirements before implementing anything.

After inspecting, give me:
1. A concise report of the current architecture and verified behavior, including any incorrect or outdated handoff details.
2. The exact files/modules relevant to the work once I provide the next requirement.
3. A proposed implementation plan with the changes grouped by file, important assumptions, compatibility risks, and how existing behavior will be preserved.
4. The tests/build checks that should be run after I authorize implementation. Do not claim results until you actually run them after authorization.

When I later provide requirements and authorize implementation, first inspect the current working tree and preserve all existing user changes. Avoid overwriting unrelated work. Make the smallest coherent change, keep the existing architecture where practical, and do not edit unrelated files. Then run appropriate tests/build checks and report the exact commands and actual results, including failures or checks not run.
```

## Inspection note

This handoff was prepared from the files currently present in the repository. No project source files were modified, no dependencies were installed, and no build or tests were run. The only intended file change is this requested handoff document.
