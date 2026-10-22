import { groundAreaShadeCoverage, type SunPosition } from '../simulation.ts';
import type { RoofPosition } from './shadeOptimization.ts';

type SearchRequest = {
  sun: SunPosition;
  positions: RoofPosition[];
};

type SearchResponse =
  | { type: 'progress'; evaluated: number; total: number }
  | { type: 'complete'; evaluated: Array<RoofPosition & { coveragePercent: number }> }
  | { type: 'error'; message: string };

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SearchRequest>) => void) | null;
  postMessage: (message: SearchResponse) => void;
};

// Reuse simulation.ts's worker-local shade rig and the cached ground sample
// grid for the entire search. A 21-candidate report interval keeps the UI's
// progress state useful without producing a render for every small batch.
scope.onmessage = async ({ data }) => {
  try {
    const evaluated: Array<RoofPosition & { coveragePercent: number }> = [];
    for (let index = 0; index < data.positions.length; index++) {
      const position = data.positions[index];
      const shade = groundAreaShadeCoverage(data.sun, position.tilt, position.heading);
      evaluated.push({ ...position, coveragePercent: shade.coveragePercent });

      if ((index + 1) % 21 === 0 && index + 1 < data.positions.length) {
        scope.postMessage({ type: 'progress', evaluated: index + 1, total: data.positions.length });
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
    scope.postMessage({ type: 'complete', evaluated });
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown shade calculation error.',
    });
  }
};
