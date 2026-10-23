# EcoBloom — Solar Park Simulator

EcoBloom is a smart solar-powered gazebo simulator featuring interactive 3D visualization, solar trajectory modeling, adaptive shade optimization, environmental controls, a cooling system, and a compact dashboard.

## Live Demo

Visit the deployed application:

**https://eco-bloom-seven.vercel.app/**

You can explore the EcoBloom simulator directly in your browser without installing anything.

> **Note:** Dashboard values, including wind thresholds, battery levels, power generation, and shade measurements, are simulated and do not represent real-time sensor readings.

## Running the Project Locally

If you want to explore the source code or continue development, follow these steps.

### Requirements
- Node.js and npm
- VS Code or another code editor (optional)

### Getting Started

1. Open the project folder in VS Code or Terminal.
2. Start the development server using one of the following methods:

   **Recommended:**
   ```bash
   npm start
   ```

   Alternatively:
   ```bash
   npm install
   npm run dev
   ```

   On macOS or Linux, you can also run:
   ```bash
   ./start.sh
   ```

3. Keep the terminal running while using the application.
4. Open the local address displayed in the terminal, usually:
   `http://localhost:5173/`

### Building for Deployment

To build the production version, run:

```bash
npm run build
```

The generated files will be placed in the `dist/` directory.

### Limitations

EcoBloom is a software simulation and prototype. Its dashboard values and system behavior are illustrative rather than validated real-world measurements.

1. Solar generation, battery levels, and wind conditions are simulated.

2. Shade measurements and canopy movement are estimates produced by the simulation.

3. The wind threshold and canopy safety responses have not been validated for real-world use.

4. The simulator is not connected to physical sensors or hardware and should not be used as a real-world safety system.
5. 
## Development Notes

- The live website is deployed on Vercel.
- Changes made to your local source files will not automatically update the live website unless the deployment process is triggered.
- This project does not automatically push changes to GitHub or publish updates to Vercel.
