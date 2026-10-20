# EcoBloom — Updated Person 3 dashboard

This is a **complete updated copy** of the EcoBloom source folder you uploaded. It preserves the original EcoBloom app (`src/App.tsx`), existing Three.js canopy (`src/park/`), and simulator functions (`src/simulation.ts`), while adding the Person 3 dashboard.

## Run on Windows (VS Code)

1. Extract this ZIP. **Open the `EcoBloom-Person3-Updated` folder itself** in VS Code (the one containing `package.json`).
2. Open **Terminal > New Terminal**.
3. Run `npm.cmd install` and wait until it finishes.
4. Run `npm.cmd run dev`.
5. Open the URL shown in Terminal (usually `http://localhost:5173/`).
6. Use the **Original park / Smart dashboard** switch at bottom-right, or visit `http://localhost:5173/?dashboard=person3`.

> Use `npm.cmd` in PowerShell if `npm.ps1 cannot be loaded` appears. Node.js must be installed.

## How the dashboard fits your teammates' work

- `src/App.tsx` — **unchanged** original park UI.
- `src/park/` — **unchanged** existing Three.js canopy and animation.
- `src/simulation.ts` — **unchanged** existing illustrative sun/shade/solar functions.
- `src/person3/Person3Dashboard.tsx` — new dashboard interface, controls, charts and 3D viewer.
- `src/person3/simulatorAdapter.ts` — **demo-only** control and energy calculations to be replaced or validated by Person 2 and Person 4.
- `src/person3/person3.css`, `src/person3/route-nav.css` — dashboard and view-switch styles.
- `src/main.tsx` — updated entry point to choose original park or dashboard.

## Confirm the production build

Run `npm.cmd run build`. If the build passes, your teammate can push the source to GitHub and deploy it with Vercel. **This ZIP does not update the GitHub repository or the public Vercel site.**

## Try these tests

- Click **Hot afternoon**: fan on, shading motion.
- Click **Strong wind**: roof moves to demo safety angles.
- Click **Evening**: lighting active when occupied, reduced solar output.
- Click **No visitors**: fan off in AUTO.
- Switch roof to **MANUAL** and change heading / tilt.
- Press **Play** to generate battery playback history.

### Simulator limitations

The solar and battery values, roof angles, shade estimates, and **12 m/s wind threshold** are illustrative only; the team has not yet validated them against hardware. This is a software prototype, not a physical safety system.
