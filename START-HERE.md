# EcoBloom — Solar Park Simulator

This is the EcoBloom source folder. It contains the complete EcoBloom app (`src/App.tsx`), Three.js procedural canopy (`src/park/`), unified compact dashboard, and simulation/optimization functions (`src/simulation.ts`, `src/park/`).

## Run on Mac / Windows / Linux (VS Code)

1. Open the project folder in VS Code or your terminal (the folder containing `package.json`).
2. Open **Terminal > New Terminal**.
3. Run `npm install` (or simply run `npm start` / `node start.mjs`, which automatically checks and installs dependencies).
4. Run `npm start` (or `npm run dev`).
5. Open the URL shown in Terminal (usually `http://localhost:5173/`).

> On Windows PowerShell, if `npm.ps1 cannot be loaded` appears, you can use `npm.cmd start` or `node start.mjs`.

## Confirm the production build

Run `npm run build` (or `npm.cmd run build` on Windows). If the build passes, your teammate can push the source to GitHub and deploy it with Vercel.

## Try these tests

- Click **Hot afternoon**: fan on, shading motion.
- Click **Strong wind**: roof moves to demo safety angles.
- Click **Evening**: lighting active when occupied, reduced solar output.
- Click **No visitors**: fan off in AUTO.
- Switch roof to **MANUAL** and change heading / tilt.
- Press **Play** to generate battery playback history.

### Simulator limitations

The solar and battery values, roof angles, shade estimates, and **12 m/s wind threshold** are illustrative only; the team has not yet validated them against hardware. This is a software prototype, not a physical safety system.
