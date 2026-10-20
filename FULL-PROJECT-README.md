# EcoBloom full updated project — Person 3 dashboard

This archive retains ALL files from your original EcoBloom-main ZIP, including `node_modules/`, `dist/`, `.img2threejs/`, `.taste-skill/`, `vendor/`, and the entire original source.

Person 3 files added:
- `src/person3/Person3Dashboard.tsx`
- `src/person3/simulatorAdapter.ts`
- `src/person3/person3.css`
- `src/person3/route-nav.css`

Existing file changed: `src/main.tsx` (adds an original-park / dashboard switch).
No changes to `src/App.tsx`, `src/park/` or `src/simulation.ts`.

## Windows / VS Code
1. Extract this ZIP. Open the INNER `EcoBloom-main` folder containing `package.json` in VS Code (File > Open Folder).
2. EASIEST: double-click `START-ECOBLOOM-WINDOWS.cmd` in the extracted folder. It deletes only the extracted, incompatible Mac `node_modules` copy, installs Windows packages, and starts the site.
   MANUAL option in VS Code terminal: `Remove-Item -Recurse -Force .\node_modules`, then `npm.cmd install`, then `npm.cmd run dev`.
3. If using manual setup, keep the Vite terminal running while using the site.
4. Visit `http://localhost:5173/` and choose **Smart dashboard**, or visit `http://localhost:5173/?dashboard=person3`. Use Vite's displayed port if different.
5. Run `npm.cmd run build` to regenerate `dist/` for publishing. The bundled `dist/` contains the ORIGINAL PRE-UPDATE website and has NOT been rebuilt; do not deploy it as the new dashboard.

## Notes
- The dashboard's wind threshold, battery, power and shade figures are simulated, not measured.
- This package does not push to GitHub or publish the Vercel website.
- Keep the team source files and coordinate merging changes with your team leader.
