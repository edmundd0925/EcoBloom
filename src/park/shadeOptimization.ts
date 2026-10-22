import { CANOPY_TILT_LIMITS } from './canopyDimensions.ts';

/** Roof pose limits used by the original park simulator's manual controls. */
export const SHADE_OPTIMIZATION_LIMITS = {
  heading: { min: -90, max: 90, step: 15 },
  tilt: { ...CANOPY_TILT_LIMITS, step: 5 },
} as const;

export type RoofPosition = { heading: number; tilt: number };
export type ShadeCandidateScore = RoofPosition & { coveragePercent: number };

const onGrid = (value: number, min: number, step: number) =>
  Math.abs((value - min) / step - Math.round((value - min) / step)) < 1e-9;

/**
 * Create the finite candidate set: 13 headings by 13 tilts, plus the exact
 * current position when it falls between grid points. Inputs must be within
 * the same limits as the UI controls.
 */
export function createShadeOptimizationPositions(current: RoofPosition): RoofPosition[] {
  const { heading, tilt } = current;
  const { heading: headingLimit, tilt: tiltLimit } = SHADE_OPTIMIZATION_LIMITS;
  if (!Number.isFinite(heading) || heading < headingLimit.min || heading > headingLimit.max) {
    throw new RangeError(`Heading must be between ${headingLimit.min} and ${headingLimit.max} degrees.`);
  }
  if (!Number.isFinite(tilt) || tilt < tiltLimit.min || tilt > tiltLimit.max) {
    throw new RangeError(`Tilt must be between ${tiltLimit.min} and ${tiltLimit.max} degrees.`);
  }

  const candidates: RoofPosition[] = [];
  for (let candidateHeading = headingLimit.min; candidateHeading <= headingLimit.max; candidateHeading += headingLimit.step) {
    for (let candidateTilt = tiltLimit.min; candidateTilt <= tiltLimit.max; candidateTilt += tiltLimit.step) {
      candidates.push({ heading: candidateHeading, tilt: candidateTilt });
    }
  }

  const currentIsOnGrid = onGrid(heading, headingLimit.min, headingLimit.step)
    && onGrid(tilt, tiltLimit.min, tiltLimit.step);
  if (!currentIsOnGrid) candidates.push({ heading, tilt });
  return candidates;
}

/**
 * Select the highest-coverage evaluated candidate. Ties prefer the candidate
 * closest to the starting pose in grid-step units, then the milder tilt, then
 * a stable numeric order. The function never invents an unevaluated position.
 */
export function chooseBestShadeCandidate<T extends ShadeCandidateScore>(
  candidates: readonly T[],
  current: RoofPosition,
): T {
  if (candidates.length === 0) throw new RangeError('At least one evaluated candidate is required.');

  const distanceFromCurrent = (candidate: RoofPosition) => {
    const headingSteps = (candidate.heading - current.heading) / SHADE_OPTIMIZATION_LIMITS.heading.step;
    const tiltSteps = (candidate.tilt - current.tilt) / SHADE_OPTIMIZATION_LIMITS.tilt.step;
    return headingSteps * headingSteps + tiltSteps * tiltSteps;
  };

  return candidates.reduce((best, candidate) => {
    if (candidate.coveragePercent > best.coveragePercent) return candidate;
    if (candidate.coveragePercent < best.coveragePercent) return best;

    const distance = distanceFromCurrent(candidate);
    const bestDistance = distanceFromCurrent(best);
    if (distance < bestDistance) return candidate;
    if (distance > bestDistance) return best;
    if (Math.abs(candidate.tilt) < Math.abs(best.tilt)) return candidate;
    if (Math.abs(candidate.tilt) > Math.abs(best.tilt)) return best;
    if (Math.abs(candidate.heading) < Math.abs(best.heading)) return candidate;
    if (Math.abs(candidate.heading) > Math.abs(best.heading)) return best;
    if (candidate.heading < best.heading) return candidate;
    if (candidate.heading > best.heading) return best;
    return candidate.tilt < best.tilt ? candidate : best;
  });
}

/** Return the best tested position only when its gain clears the movement threshold. */
export function chooseImprovingShadeCandidate<T extends ShadeCandidateScore>(
  candidates: readonly T[],
  current: RoofPosition,
  currentCoveragePercent: number,
  minimumImprovementPercent: number,
) {
  const best = chooseBestShadeCandidate(candidates, current);
  return best.coveragePercent - currentCoveragePercent >= minimumImprovementPercent
    ? best
    : null;
}
