import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BatteryCharging, ChevronDown, CircleHelp, Clock3, Compass, Fan, Leaf, Lightbulb, Pause, Play, RotateCcw, Settings2, Sun, Users, Zap } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { automaticAngle, daylight, createGroundShadeResultCache, groundAreaShadeCoverage, groundShadeCoverageCacheKey, MYT_UTC_OFFSET_HOURS, shadeCoverage, solarOutput, sunGeometry, sunPosition3d, type HistoryPoint, type Speed } from './simulation';
import { CanopyScene } from './park/CanopyScene';
import { CANOPY_TILT_LIMITS } from './park/canopyDimensions';
import type { GroundShadeResult } from './park/groundShadeCoverage';
import { ADAPTIVE_SHADE_MINIMUM_IMPROVEMENT_PERCENT, ADAPTIVE_SHADE_TRIGGER_ANGLE_DEGREES, adaptiveShadeInputKey, adaptiveTargetForSun, calculateAdaptiveTargetPose, createAdaptiveShadeSearchCache, initialShadePoseEstimate, isAdaptiveShadeSearchCurrent, manualTimeChangeSearchAction, scheduleAdaptiveShadeSearch, shouldSearchAdaptiveShade, transitionAdaptiveControlMode } from './park/adaptiveShade';
import { chooseBestShadeCandidate, chooseImprovingShadeCandidate, createShadeOptimizationPositions } from './park/shadeOptimization';
import type { RoofPosition } from './park/shadeOptimization';

const fmtTime = (t: number) => `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
const fmtHour = (t: number) => t / 60;
type FanSpeed = 'Low' | 'Medium' | 'High';
const FAN_POWER_KW: Record<FanSpeed, number> = { Low: 0.32, Medium: 0.56, High: 0.84 };
const initialMytDate = () => new Date(Date.now() + MYT_UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
const IconButton = ({ children, onClick, active = false, label }: { children: React.ReactNode; onClick: () => void; active?: boolean; label: string }) => <button aria-label={label} title={label} onClick={onClick} className={`icon-button ${active ? 'selected' : ''}`}>{children}</button>;
type AdaptiveShadeState =
  | { status: 'idle' | 'searching' | 'no-sun' }
  | { status: 'applied'; heading: number; tilt: number; coveragePercent: number; improvementPercent: number; candidatesEvaluated: number }
  | { status: 'held'; heading: number; tilt: number; coveragePercent: number; bestCoveragePercent: number; improvementPercent: number; candidatesEvaluated: number }
  | { status: 'error'; message: string };
type ShadeSearchWorkerMessage =
  | { type: 'progress'; evaluated: number; total: number }
  | { type: 'complete'; evaluated: Array<RoofPosition & { coveragePercent: number }> }
  | { type: 'error'; message: string };
type EvaluatedShadeCandidate = RoofPosition & { coveragePercent: number };

export default function App() {
  const [minute, setMinute] = useState(9 * 60 + 24), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState<Speed>(1);
  const [sunlight, setSunlight] = useState(78), [temperature, setTemperature] = useState(29), [battery, setBattery] = useState(76);
  const [batteryStart, setBatteryStart] = useState(76), [angleMode, setAngleMode] = useState<'Auto'|'Manual'>('Auto'), [manualAngle, setManualAngle] = useState(0), [autoCooling, setAutoCooling] = useState(false);
  const [fanMode, setFanMode] = useState<'Auto'|'Manual'>('Auto'), [manualFan, setManualFan] = useState(false), [threshold, setThreshold] = useState(30), [fanSpeed, setFanSpeed] = useState<FanSpeed>('Medium'), [preview, setPreview] = useState(false);
  const [headingMode, setHeadingMode] = useState<'Auto'|'Manual'>('Auto'), [manualHeading, setManualHeading] = useState(0), [occupancy, setOccupancy] = useState(5);
  const [simDate, setSimDate] = useState(initialMytDate), [latitude, setLatitude] = useState(3.139), [longitude, setLongitude] = useState(101.686);
  const [history, setHistory] = useState<HistoryPoint[]>([]), [events, setEvents] = useState(['Adaptive shading aligned with the morning sun', 'System online · all sensors connected']);
  const lastMinute = useRef(minute), prevNight = useRef(false), prevFan = useRef(false);
  const [shadeSnapshot, setShadeSnapshot] = useState<{ key: string; result: GroundShadeResult } | null>(null);
  const [shadeSliderActive, setShadeSliderActive] = useState(false);
  const [adaptivePose, setAdaptivePose] = useState<{ heading: number; tilt: number } | null>(null);
  const [adaptiveRefinement, setAdaptiveRefinement] = useState<{ heading: number; tilt: number }>({ heading: 0, tilt: 0 });
  const [adaptiveShadeState, setAdaptiveShadeState] = useState<AdaptiveShadeState>({ status: 'idle' });
  const [adaptiveProgress, setAdaptiveProgress] = useState({ evaluated: 0, total: 0 });
  const [adaptiveSearchQueued, setAdaptiveSearchQueued] = useState(false);
  const [adaptiveSearchRevision, setAdaptiveSearchRevision] = useState(0);
  const adaptiveSearchRunRef = useRef(0);
  const adaptiveSearchRunningRef = useRef(false);
  const adaptiveSearchWorkerRef = useRef<Worker | null>(null);
  const activeSearchContextRef = useRef<string | null>(null);
  const activeSearchAllowsClockDriftRef = useRef(false);
  const manualClockUpdateRef = useRef(false);
  const timeSliderInteractionRef = useRef(false);
  const manualTimeSearchPendingRef = useRef(false);
  const adaptiveSearchCacheRef = useRef<ReturnType<typeof createAdaptiveShadeSearchCache<number>> | null>(null);
  if (!adaptiveSearchCacheRef.current) adaptiveSearchCacheRef.current = createAdaptiveShadeSearchCache<number>(512);
  const adaptiveSearchCache = adaptiveSearchCacheRef.current!;
  const lastAdaptiveSearchSunRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const shadeSliderActiveRef = useRef(false);
  const shadeCacheRef = useRef<ReturnType<typeof createGroundShadeResultCache> | null>(null);
  if (!shadeCacheRef.current) shadeCacheRef.current = createGroundShadeResultCache();
  const beginShadeSliderInteraction = () => {
    if (shadeSliderActiveRef.current) return;
    shadeSliderActiveRef.current = true;
    setShadeSliderActive(true);
  };
  const endShadeSliderInteraction = () => {
    if (!shadeSliderActiveRef.current) return;
    shadeSliderActiveRef.current = false;
    setShadeSliderActive(false);
    if (!timeSliderInteractionRef.current) return;
    timeSliderInteractionRef.current = false;
    if (!manualTimeSearchPendingRef.current) return;
    manualTimeSearchPendingRef.current = false;
    lastAdaptiveSearchSunRef.current = null;
    setAdaptiveRefinement({ heading: 0, tilt: 0 });
    setAdaptiveSearchRevision(revision => revision + 1);
  };
  const cancelAdaptiveSearch = () => {
    if (!adaptiveSearchWorkerRef.current && !adaptiveSearchRunningRef.current) return;
    adaptiveSearchRunRef.current += 1;
    adaptiveSearchWorkerRef.current?.terminate();
    adaptiveSearchWorkerRef.current = null;
    adaptiveSearchRunningRef.current = false;
    activeSearchContextRef.current = null;
    activeSearchAllowsClockDriftRef.current = false;
    setAdaptiveSearchQueued(false);
  };
  const handleShadeSliderKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) beginShadeSliderInteraction();
  };
  const beginTimeSliderInteraction = () => {
    timeSliderInteractionRef.current = true;
    beginShadeSliderInteraction();
  };
  const handleTimeSliderKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) return;
    timeSliderInteractionRef.current = true;
    beginShadeSliderInteraction();
  };
  const shadeSliderProps = { onPointerDown: beginShadeSliderInteraction, onKeyDown: handleShadeSliderKeyDown };
  const timeSliderProps = { onPointerDown: beginTimeSliderInteraction, onKeyDown: handleTimeSliderKeyDown };
  const hour = fmtHour(minute);
  const sunPosition = useMemo(() => sunPosition3d(simDate, minute, latitude, longitude), [simDate, minute, latitude, longitude]);
  const night = useMemo(() => daylight(simDate, minute, latitude, longitude) < 0.03, [simDate, minute, latitude, longitude]), activeNight = night || preview;
  const sun = sunGeometry(sunPosition);
  const adaptiveEnabled = angleMode === 'Auto' && headingMode === 'Auto';
  const fastPose = useMemo(
    () => initialShadePoseEstimate(sunPosition.rawElevation > 0, sunPosition.vector, sunPosition.elevation),
    [sunPosition],
  );
  const fallbackAutomaticAngle = automaticAngle(hour, temperature);
  const fallbackAutomaticHeading = Math.max(-55, Math.min(55, 180 - sunPosition.azimuth));

  const currentAutoTarget = useMemo(
    () => calculateAdaptiveTargetPose(fastPose, adaptiveRefinement, sunPosition.rawElevation > 0),
    [fastPose, adaptiveRefinement, sunPosition.rawElevation],
  );

  const angle = angleMode === 'Auto'
    ? (adaptiveEnabled ? currentAutoTarget.tilt : fallbackAutomaticAngle)
    : manualAngle;
  const heading = headingMode === 'Auto'
    ? (adaptiveEnabled ? currentAutoTarget.heading : fallbackAutomaticHeading)
    : manualHeading;
  const adaptiveInputKey = adaptiveShadeInputKey(simDate, minute, latitude, longitude);
  const adaptiveContextKey = JSON.stringify([simDate, latitude, longitude]);
  const latestAdaptiveInputsRef = useRef({ sunPosition, night, adaptiveEnabled, inputKey: adaptiveInputKey, contextKey: adaptiveContextKey, playing });
  latestAdaptiveInputsRef.current = { sunPosition, night, adaptiveEnabled, inputKey: adaptiveInputKey, contextKey: adaptiveContextKey, playing };
  const adaptiveInputKeyRef = useRef(adaptiveInputKey);
  const currentTargetRef = useRef({ heading, tilt: angle });
  currentTargetRef.current = { heading, tilt: angle };
  const shadeKey = groundShadeCoverageCacheKey({ date: simDate, minute, latitude, longitude, angle, heading });
  const shade = shadeSnapshot?.result ?? null;
  const shadeUpdating = shadeSliderActive || !shadeSnapshot || shadeSnapshot.key !== shadeKey;
  const shadeLabel = shade ? (shade.directSunAvailable ? `${shade.coveragePercent}%` : 'No direct sun') : 'Calculating…';
  useEffect(() => {
    if (shadeSliderActive) return;
    const timeout = window.setTimeout(() => {
      if (shadeSliderActiveRef.current) return;
      const result = shadeCacheRef.current!.getOrCalculate(shadeKey, () => groundAreaShadeCoverage(sunPosition, angle, heading));
      setShadeSnapshot(current => current?.key === shadeKey ? current : { key: shadeKey, result });
    }, 140);
    return () => window.clearTimeout(timeout);
  }, [shadeKey, shadeSliderActive, sunPosition, angle, heading]);
  useEffect(() => {
    if (playing && adaptiveSearchWorkerRef.current && activeSearchContextRef.current === adaptiveContextKey) {
      activeSearchAllowsClockDriftRef.current = true;
    }
    if (adaptiveInputKeyRef.current === adaptiveInputKey) return;
    adaptiveInputKeyRef.current = adaptiveInputKey;
    const wasManualClockChange = manualClockUpdateRef.current;
    manualClockUpdateRef.current = false;
    if (!adaptiveSearchWorkerRef.current) return;
    if (playing && !wasManualClockChange && activeSearchContextRef.current === adaptiveContextKey) {
      activeSearchAllowsClockDriftRef.current = true;
      const schedule = scheduleAdaptiveShadeSearch(
        adaptiveEnabled,
        sunPosition.rawElevation > 0,
        sunPosition.vector,
        lastAdaptiveSearchSunRef.current,
        true,
      );
      setAdaptiveSearchQueued(current => current === (schedule === 'queue') ? current : schedule === 'queue');
      return;
    }
    cancelAdaptiveSearch();
    setAdaptiveSearchQueued(false);
    setAdaptiveProgress({ evaluated: 0, total: 0 });
    setAdaptiveShadeState(current => current.status === 'searching' ? { status: 'idle' } : current);
  }, [adaptiveInputKey, adaptiveContextKey, playing, adaptiveEnabled, sunPosition]);
  useEffect(() => () => {
    adaptiveSearchRunRef.current += 1;
    adaptiveSearchWorkerRef.current?.terminate();
    adaptiveSearchWorkerRef.current = null;
    adaptiveSearchRunningRef.current = false;
    activeSearchContextRef.current = null;
    activeSearchAllowsClockDriftRef.current = false;
    lastAdaptiveSearchSunRef.current = null;
  }, []);
  useEffect(() => {
    if (adaptiveEnabled) return;
    cancelAdaptiveSearch();
    lastAdaptiveSearchSunRef.current = null;
    setAdaptiveSearchQueued(false);
    setAdaptiveProgress({ evaluated: 0, total: 0 });
    setAdaptiveShadeState(current => current.status === 'idle' ? current : { status: 'idle' });
  }, [adaptiveEnabled]);
  useEffect(() => {
    if (!adaptiveEnabled) return;
    const directSunAvailable = sunPosition.rawElevation > 0;
    if (!directSunAvailable) {
      lastAdaptiveSearchSunRef.current = null;
      cancelAdaptiveSearch();
      setAdaptiveSearchQueued(false);
      setAdaptiveRefinement({ heading: 0, tilt: 0 });
      setAdaptiveProgress(current => current.evaluated === 0 && current.total === 0
        ? current
        : { evaluated: 0, total: 0 });
      setAdaptivePose(current => {
        const centered = adaptiveTargetForSun(true, false, current ?? currentTargetRef.current);
        return current?.heading === centered.heading && current?.tilt === centered.tilt ? current : centered;
      });
      setAdaptiveShadeState(current => current.status === 'no-sun' ? current : { status: 'no-sun' });
      return;
    }
    // A manual time-slider drag cancels stale work immediately, then waits for
    // release before starting one fresh sweep at the final selected time.
    if (timeSliderInteractionRef.current && manualTimeSearchPendingRef.current) return;
    if (scheduleAdaptiveShadeSearch(true, true, sunPosition.vector, lastAdaptiveSearchSunRef.current, adaptiveSearchRunningRef.current) !== 'start') return;

    const runId = ++adaptiveSearchRunRef.current;
    const searchSun = sunPosition;
    const searchInputKey = adaptiveInputKey;
    const searchContextKey = adaptiveContextKey;
    const searchFastPose = initialShadePoseEstimate(searchSun.rawElevation > 0, searchSun.vector, searchSun.elevation);
    const startingPosition = { ...currentTargetRef.current };
    setAdaptivePose(current => current ?? startingPosition);
    const positions = createShadeOptimizationPositions(startingPosition);
    const candidateCacheKey = (position: RoofPosition) => groundShadeCoverageCacheKey({
      date: simDate,
      minute,
      latitude,
      longitude,
      angle: position.tilt,
      heading: position.heading,
    });
    const cachedEvaluations: EvaluatedShadeCandidate[] = [];
    const positionsToEvaluate: RoofPosition[] = [];
    for (const position of positions) {
      const cachedCoverage = adaptiveSearchCache.get(candidateCacheKey(position));
      if (cachedCoverage === undefined) positionsToEvaluate.push(position);
      else cachedEvaluations.push({ ...position, coveragePercent: cachedCoverage });
    }
    lastAdaptiveSearchSunRef.current = searchSun.vector;

    const applyEvaluated = (evaluated: EvaluatedShadeCandidate[]) => {
      const currentCandidate = evaluated.find(candidate =>
        Math.abs(candidate.heading - startingPosition.heading) < 1e-8
        && Math.abs(candidate.tilt - startingPosition.tilt) < 1e-8);
      if (!currentCandidate) {
        setAdaptiveShadeState({ status: 'error', message: 'The evaluated search did not include the current roof position.' });
        return;
      }

      const best = chooseBestShadeCandidate(evaluated, startingPosition);
      const improvement = best.coveragePercent - currentCandidate.coveragePercent;
      const improvingCandidate = chooseImprovingShadeCandidate(
        evaluated,
        startingPosition,
        currentCandidate.coveragePercent,
        ADAPTIVE_SHADE_MINIMUM_IMPROVEMENT_PERCENT,
      );
      if (improvingCandidate) {
        setAdaptiveRefinement({
          heading: Math.max(-45, Math.min(45, improvingCandidate.heading - searchFastPose.heading)),
          tilt: Math.max(-20, Math.min(20, improvingCandidate.tilt - searchFastPose.tilt)),
        });
        setAdaptivePose({ heading: improvingCandidate.heading, tilt: improvingCandidate.tilt });
        setAdaptiveShadeState({
          status: 'applied',
          heading: improvingCandidate.heading,
          tilt: improvingCandidate.tilt,
          coveragePercent: improvingCandidate.coveragePercent,
          improvementPercent: improvement,
          candidatesEvaluated: evaluated.length,
        });
      } else {
        setAdaptiveShadeState({
          status: 'held',
          heading: startingPosition.heading,
          tilt: startingPosition.tilt,
          coveragePercent: currentCandidate.coveragePercent,
          bestCoveragePercent: best.coveragePercent,
          improvementPercent: Math.max(0, improvement),
          candidatesEvaluated: evaluated.length,
        });
      }
      setAdaptiveProgress({ evaluated: evaluated.length, total: positions.length });
    };

    if (positionsToEvaluate.length === 0) {
      applyEvaluated(cachedEvaluations);
      return;
    }

    adaptiveSearchRunningRef.current = true;
    activeSearchContextRef.current = searchContextKey;
    activeSearchAllowsClockDriftRef.current = playing;
    setAdaptiveSearchQueued(false);
    setAdaptiveShadeState({ status: 'searching' });
    setAdaptiveProgress({ evaluated: cachedEvaluations.length, total: positions.length });

    const worker = new Worker(new URL('./park/shadeOptimization.worker.ts', import.meta.url), { type: 'module' });
    adaptiveSearchWorkerRef.current = worker;
    const searchIsStillCurrent = () => {
      const latest = latestAdaptiveInputsRef.current;
      return isAdaptiveShadeSearchCurrent(
        runId,
        adaptiveSearchRunRef.current,
        searchInputKey,
        latest.inputKey,
        latest.adaptiveEnabled,
        {
          allowClockDrift: activeSearchAllowsClockDriftRef.current,
          sameContext: searchContextKey === latest.contextKey,
          directSunAvailable: latest.sunPosition.rawElevation > 0,
          searchSun: searchSun.vector,
          currentSun: latest.sunPosition.vector,
          maxDriftDegrees: ADAPTIVE_SHADE_TRIGGER_ANGLE_DEGREES,
        },
      ) && latest.sunPosition.rawElevation > 0;
    };
    const finishWorker = () => {
      worker.terminate();
      if (adaptiveSearchWorkerRef.current === worker) adaptiveSearchWorkerRef.current = null;
      if (runId === adaptiveSearchRunRef.current) {
        adaptiveSearchRunningRef.current = false;
        activeSearchContextRef.current = null;
        activeSearchAllowsClockDriftRef.current = false;
      }
    };

    worker.onmessage = (event: MessageEvent<ShadeSearchWorkerMessage>) => {
      if (!searchIsStillCurrent()) {
        finishWorker();
        const latest = latestAdaptiveInputsRef.current;
        if (latest.adaptiveEnabled && latest.sunPosition.rawElevation > 0) {
          lastAdaptiveSearchSunRef.current = null;
          setAdaptiveSearchRevision(revision => revision + 1);
        }
        return;
      }
      const message = event.data;
      if (message.type === 'progress') {
        const evaluatedCount = cachedEvaluations.length + message.evaluated;
        setAdaptiveProgress(current => current.evaluated === evaluatedCount && current.total === positions.length
          ? current
          : { evaluated: evaluatedCount, total: positions.length });
        return;
      }
      if (message.type === 'error') {
        setAdaptiveShadeState({ status: 'error', message: message.message });
        finishWorker();
        return;
      }

      const evaluated = [...cachedEvaluations, ...message.evaluated];
      for (const candidate of message.evaluated) {
        adaptiveSearchCache.set(candidateCacheKey(candidate), candidate.coveragePercent);
      }
      const latest = latestAdaptiveInputsRef.current;
      const scheduleNext = scheduleAdaptiveShadeSearch(
        latest.adaptiveEnabled,
        latest.sunPosition.rawElevation > 0,
        latest.sunPosition.vector,
        lastAdaptiveSearchSunRef.current,
        false,
      ) === 'start';
      applyEvaluated(evaluated);
      finishWorker();
      setAdaptiveSearchQueued(false);
      if (scheduleNext) setAdaptiveSearchRevision(revision => revision + 1);
    };
    worker.onerror = event => {
      if (searchIsStillCurrent()) {
        setAdaptiveShadeState({ status: 'error', message: event.message || 'The background shade search failed.' });
      }
      finishWorker();
    };
    worker.postMessage({ sun: searchSun, positions: positionsToEvaluate });
  }, [adaptiveEnabled, sunPosition, night, adaptiveInputKey, adaptiveSearchRevision]);
  useEffect(() => {
    if (!shadeSliderActive) return;
    const finishInteraction = () => endShadeSliderInteraction();
    window.addEventListener('pointerup', finishInteraction);
    window.addEventListener('pointercancel', finishInteraction);
    window.addEventListener('keyup', finishInteraction);
    window.addEventListener('blur', finishInteraction);
    return () => {
      window.removeEventListener('pointerup', finishInteraction);
      window.removeEventListener('pointercancel', finishInteraction);
      window.removeEventListener('keyup', finishInteraction);
      window.removeEventListener('blur', finishInteraction);
    };
  }, [shadeSliderActive]);
  const personShade = useMemo(() => shadeCoverage(simDate, minute, angle, heading, latitude, longitude, occupancy), [simDate, minute, angle, heading, latitude, longitude, occupancy]);
  useEffect(() => { if (temperature >= threshold) setAutoCooling(true); else if (temperature <= threshold - 1.5) setAutoCooling(false); }, [temperature, threshold]);
  const fansOn = fanMode === 'Auto' ? autoCooling && battery > 7 : manualFan && battery > 2;
  const effectiveSpeed = battery < 12 && fanSpeed === 'High' ? 'Low' : fanSpeed;
  const fanKw = fansOn ? FAN_POWER_KW[effectiveSpeed] : 0;
  const solar = useMemo(() => solarOutput(simDate, minute, sunlight, angle, heading, latitude, longitude), [simDate, minute, sunlight, angle, heading, latitude, longitude]), lighting = activeNight && battery > 5 ? .24 : 0, demand = .18 + fanKw + lighting;
  const energyState = solar > demand + .1 ? 'Charging' : solar + .1 < demand ? 'Discharging' : 'Balanced';
  const runtime = demand > 0 && battery / 100 * 48 > 2.4 ? Math.floor(((battery / 100 * 48 - 2.4) * 60) / demand) : 0;
  const pushEvent = (msg: string) => setEvents(e => [msg, ...e].slice(0, 20));
  useEffect(() => { if (!playing) return; const id = window.setInterval(() => setMinute(m => (m + speed) % 1440), 900); return () => clearInterval(id); }, [playing, speed]);
  useEffect(() => {
    if (minute !== lastMinute.current) {
      const delta = ((minute - lastMinute.current + 1440) % 1440) / 60; lastMinute.current = minute;
      const net = solar - demand;
      setBattery(b => Math.max(0, Math.min(100, b + net * delta / 48 * 100 * (net >= 0 ? .92 : 1.08))));
      setHistory(h => [...h.slice(-31), { time: fmtTime(minute), solar: +solar.toFixed(1), demand: +demand.toFixed(1), battery: +battery.toFixed(1), temp: temperature, angle: +angle.toFixed(1), fan: fansOn ? 1 : 0 }]);
    }
  }, [minute, solar, demand]);
  useEffect(() => { if (night !== prevNight.current) { pushEvent(night ? 'Night bloom activated · decorative lights on' : 'Day mode restored · panels tracking sunlight'); prevNight.current = night; } }, [night]);
  useEffect(() => { if (fansOn !== prevFan.current) { pushEvent(fansOn ? `Cooling fans activated · ${effectiveSpeed.toLowerCase()} speed` : 'Cooling fans stopped · below activation threshold'); prevFan.current = fansOn; } }, [fansOn, effectiveSpeed]);
  const reset = () => { cancelAdaptiveSearch(); lastAdaptiveSearchSunRef.current=null; setAdaptiveSearchQueued(false); setAdaptiveSearchRevision(revision=>revision+1); setAdaptivePose(null); setAdaptiveRefinement({ heading: 0, tilt: 0 }); setAdaptiveShadeState({status:'idle'}); setMinute(9*60+24); setPlaying(false); setSpeed(1); setSunlight(78); setTemperature(29); setBattery(batteryStart); setAngleMode('Auto'); setManualAngle(0); setHeadingMode('Auto'); setManualHeading(0); setOccupancy(5); setFanMode('Auto'); setManualFan(false); setAutoCooling(false); setThreshold(30); setFanSpeed('Medium'); setPreview(false); setHistory([]); pushEvent('Scenario reset to morning defaults'); };
  const chartData = useMemo(() => history.length ? history : [{ time: fmtTime(minute), solar: +solar.toFixed(1), demand: +demand.toFixed(1), battery: battery, temp: temperature, angle, fan: fansOn ? 1 : 0 }], [history, minute, solar, demand, battery, temperature, angle, fansOn]);
  const setClock = (value: number) => {
    if (value === minute) return;
    manualClockUpdateRef.current = true;
    lastMinute.current = value;
    setMinute(value);
    const searchAction = manualTimeChangeSearchAction(adaptiveEnabled, timeSliderInteractionRef.current);
    manualTimeSearchPendingRef.current = searchAction === 'defer';
    if (searchAction === 'search') {
      // Manual edits are explicit requests, so bypass the playback sun-angle
      // threshold by establishing a fresh search baseline.
      lastAdaptiveSearchSunRef.current = null;
      setAdaptiveRefinement({ heading: 0, tilt: 0 });
      setAdaptiveSearchRevision(revision => revision + 1);
    }
  };
  const toggleAdaptiveShading = () => {
    const currentMode = adaptiveEnabled ? 'adaptive' : 'manual';
    const transition = transitionAdaptiveControlMode(currentMode, { heading, tilt: angle });
    if (transition.mode === 'manual') {
      cancelAdaptiveSearch();
      setManualAngle(transition.pose.tilt);
      setManualHeading(transition.pose.heading);
      setAngleMode('Manual');
      setHeadingMode('Manual');
      return;
    }
    lastAdaptiveSearchSunRef.current = null;
    setAdaptivePose(transition.pose);
    setAdaptiveRefinement({ heading: 0, tilt: 0 });
    setAdaptiveShadeState({ status: 'idle' });
    setAngleMode('Auto');
    setHeadingMode('Auto');
  };
  const toggleRoofHeadingMode = () => {
    if (headingMode === 'Auto') {
      cancelAdaptiveSearch();
      setManualAngle(angle);
      setManualHeading(heading);
      setAngleMode('Manual');
      setHeadingMode('Manual');
      return;
    }
    setHeadingMode('Auto');
  };

  return (
    <div className="app-layout">
      {/* Left Navigation Dock */}
      <nav className="nav-dock" aria-label="Main Navigation">
        <div className="dock-logo" title="EcoBloom Smart Solar">
          <Leaf size={18} />
        </div>
        <div className="dock-nav-items">
          <button
            className="dock-btn coral-nav"
            title="Block 1: Solar & Energy"
            onClick={() => document.getElementById('block-coral')?.scrollIntoView({ behavior: 'smooth' })}
            aria-label="Solar & Energy"
          >
            <Zap size={16} />
          </button>
          <button
            className="dock-btn ice-nav"
            title="Block 2: Canopy & Shading"
            onClick={() => document.getElementById('block-ice')?.scrollIntoView({ behavior: 'smooth' })}
            aria-label="Canopy & Shading"
          >
            <Compass size={16} />
          </button>
          <button
            className="dock-btn periwinkle-nav"
            title="Block 3: Battery & Visitors"
            onClick={() => document.getElementById('block-periwinkle')?.scrollIntoView({ behavior: 'smooth' })}
            aria-label="Battery & Visitors"
          >
            <Users size={16} />
          </button>
          <button
            className="dock-btn sage-nav"
            title="Block 4: Environment & Cooling"
            onClick={() => document.getElementById('block-sage')?.scrollIntoView({ behavior: 'smooth' })}
            aria-label="Environment & Cooling"
          >
            <Fan size={16} />
          </button>
        </div>
        <div className="dock-bottom">
          <button
            className={`dock-btn ${playing ? 'active' : ''}`}
            title={playing ? 'Pause Simulation' : 'Play Simulation'}
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button className="dock-btn" title="Reset Simulation" onClick={reset} aria-label="Reset">
            <RotateCcw size={15} />
          </button>
        </div>
      </nav>

      {/* Main Workspace */}
      <main className="main-workspace">
        {/* Topbar */}
        <header className="dashboard-topbar">
          <div className="topbar-left">
            <div className="breadcrumb">
              <span className="breadcrumb-brand">EcoBloom<span>®</span></span>
              <span className="breadcrumb-sep">/</span>
              <span>Smart Solar Park</span>
              <span className="breadcrumb-sep">/</span>
              <span className="breadcrumb-current">Canopy 01</span>
            </div>
            <span className="live-pill">
              <span className="live-dot" /> LIVE
            </span>
          </div>

          <div className="topbar-right">
            <div className="status-badge">
              <i className={night ? 'moon-dot' : 'sun-dot'} />
              <span>{night ? 'Night Mode' : 'Day Mode'}</span>
            </div>

            <div className="status-badge">
              <Clock3 size={12} />
              <span>{fmtTime(minute)} MYT</span>
            </div>

            <div className="playback-capsule">
              <button
                className={`play-toggle-btn ${playing ? 'playing' : ''}`}
                onClick={() => setPlaying(!playing)}
                aria-label={playing ? 'Pause simulation' : 'Play simulation'}
              >
                {playing ? <Pause size={12} /> : <Play size={12} />}
                <span>{playing ? 'PAUSE' : 'PLAY'}</span>
              </button>
              <div className="speed-chips">
                {([1, 2, 4] as Speed[]).map(n => (
                  <button
                    key={n}
                    className={`speed-chip ${n === speed ? 'active' : ''}`}
                    onClick={() => setSpeed(n)}
                    aria-label={`${n}x speed`}
                  >
                    {n}×
                  </button>
                ))}
              </div>
              <button className="reset-top-btn" onClick={reset} title="Reset simulation" aria-label="Reset simulation">
                <RotateCcw size={13} />
              </button>
            </div>
          </div>
        </header>

        {/* Upper Grid: 3D Visualization + Telemetry Dock */}
        <section className="upper-grid">
          {/* Main 3D Viewport Card */}
          <div className="canopy-3d-card">
            <div className="canopy-3d-header">
              <div className="canopy-header-badges">
                <div className="canopy-title-chip">
                  <Leaf size={13} />
                  <span>Canopy 01</span> · 3D Solar Viewport
                </div>
              </div>
              <div className="scene-overlay-stats">
                <div className="overlay-chip">
                  <span>Sun Elevation:</span>
                  <b>{sunPosition.rawElevation.toFixed(1)}°</b>
                </div>
                <div className="overlay-chip">
                  <span>Ground Shade:</span>
                  <b>{shadeLabel}</b>
                  {shadeUpdating && <small> (calc…)</small>}
                </div>
                <div className="overlay-chip">
                  <span>Tilt / Heading:</span>
                  <b>{angle > 0 ? '+' : ''}{angle.toFixed(1)}° / {heading.toFixed(0)}°</b>
                </div>
              </div>
            </div>

            <div className="canopy-3d-viewport">
              <CanopyScene
                heading={heading}
                tilt={angle}
                sunDirection={sunPosition.vector}
                fansOn={fansOn}
                night={night || preview}
                occupancy={occupancy}
              />
            </div>

            <div className="canopy-3d-footer">
              <div className="canopy-legend">
                <span><i className="legend-dot-sun" /> Sun vector</span>
                <span><i className="legend-dot-shade" /> Ground shadow</span>
                <span>Occupancy: {occupancy}/8 seated</span>
              </div>
              <div className="interactive-hint">
                Interactive 3D · Drag to rotate · Scroll to zoom
              </div>
            </div>
          </div>

          {/* Telemetry & 2D Elevation Dock */}
          <aside className="telemetry-dock">
            <div className="telemetry-card-head">
              <span className="telemetry-title">
                <Sun size={12} /> 2D PARK ELEVATION
              </span>
              <span className="live-pill" style={{ padding: '1px 5px', fontSize: '8px' }}>
                {playing ? `${speed}×` : 'PAUSED'}
              </span>
            </div>

            <div className="elevation-preview-wrap">
              <svg className={`park-svg ${night ? 'night' : ''}`} viewBox="0 0 900 510" role="img" aria-label="Animated 2D solar park with EcoBloom canopy">
                <defs>
                  <linearGradient id="sky" x2="0" y2="1"><stop stopColor={night ? '#163553' : '#b8e1e8'} /><stop offset="1" stopColor={night ? '#9cb9c1' : '#f1f2dc'} /></linearGradient>
                  <linearGradient id="lawn" x2="0" y2="1"><stop stopColor="#8fc77b" /><stop offset="1" stopColor="#529e69" /></linearGradient>
                  <linearGradient id="roof" x2="0" y2="1"><stop stopColor={night ? '#c7ddd5' : '#fffef4'} /><stop offset=".52" stopColor={night ? '#92afa7' : '#e1e8d6'} /><stop offset="1" stopColor={night ? '#63877d' : '#bacbb5'} /></linearGradient>
                  <linearGradient id="column" x2="1"><stop stopColor="#d3dfd4" /><stop offset=".48" stopColor="#fff" /><stop offset="1" stopColor="#9caeaa" /></linearGradient>
                  <linearGradient id="path" x2="0" y2="1"><stop stopColor="#e6e4d5" /><stop offset="1" stopColor="#c9c9b4" /></linearGradient>
                  <filter id="soft"><feGaussianBlur stdDeviation="9" /></filter>
                  <filter id="glow"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                  <pattern id="panels" width="20" height="12" patternUnits="userSpaceOnUse"><path d="M0 0H20M0 6H20M0 12H20M10 0V12" stroke="#7eaaa3" strokeWidth=".8" opacity=".68" /></pattern>
                </defs>
                <rect width="900" height="510" fill="url(#sky)" />
                {night && Array.from({ length: 18 }, (_, i) => <circle key={i} cx={(i * 83 + 34) % 890} cy={(i * 37 + 25) % 175} r={i % 3 === 0 ? 1.7 : 1.1} fill="#fff8cf" opacity=".76" />)}
                {!night ? (
                  <g><circle cx={sun.x} cy={sun.y} r="27" fill="#fff5bf" opacity=".28" /><circle cx={sun.x} cy={sun.y} r="19" fill="#ffe28d" /><circle cx={sun.x} cy={sun.y} r="13" fill="#fff4c3" /></g>
                ) : (
                  <g><circle cx="760" cy="72" r="23" fill="#e1e8d5" /><circle cx="770" cy="64" r="22" fill="#163553" /></g>
                )}
                <path d="M0 246 Q128 214 244 242 Q373 206 488 242 Q656 210 900 245 L900 345H0Z" fill="#bed3bf" opacity=".6" />
                <path d="M0 294 Q150 266 296 295 Q480 264 660 300 Q770 275 900 294V420H0Z" fill="#a5c69e" opacity=".74" />
                <g opacity=".72"><path d="M72 306V236" stroke="#866843" strokeWidth="9" /><circle cx="72" cy="226" r="38" fill="#6eaa76" /><circle cx="44" cy="239" r="24" fill="#82b77b" /><circle cx="94" cy="242" r="25" fill="#5d9c6b" /><path d="M808 302V205" stroke="#886947" strokeWidth="11" /><circle cx="808" cy="195" r="54" fill="#639d68" /><circle cx="771" cy="214" r="32" fill="#79ae71" /><circle cx="841" cy="217" r="29" fill="#508c61" /></g>
                <path d="M0 359 Q209 331 413 356 Q625 378 900 345V510H0Z" fill="url(#lawn)" />
                <path d="M0 424 Q171 390 356 408 Q607 432 900 391V510H0Z" fill="#71b375" opacity=".55" />
                <path d="M0 487 Q199 446 388 470 Q601 495 900 444" fill="none" stroke="#d8ddbe" strokeWidth="36" />
                <path d="M0 487 Q199 446 388 470 Q601 495 900 444" fill="none" stroke="#efead5" strokeWidth="29" />
                <ellipse cx="445" cy="390" rx={160 + Math.abs(angle) * 2} ry="25" fill="#29483f" opacity=".29" transform={`translate(${Math.sin(hour / 24 * Math.PI * 2) * 20} 0)`} filter="url(#soft)" />
                <ellipse cx="450" cy="390" rx="135" ry="16" fill="#34594d" opacity=".25" />
                <g opacity=".47" transform="translate(720 0) scale(.48)"><path d="M-150 206 Q-127 144 0 137 Q127 144 150 206 Q93 220 0 212 Q-93 220 -150 206Z" fill="#f1f3e7" /><path d="M0 199V355" stroke="#e8eee3" strokeWidth="14" /></g>
                <g transform="translate(450 0)">
                  <path d="M-15 229 L-10 365 Q0 373 10 365 L15 229Z" fill="url(#column)" />
                  <path d="M-6 235V360" stroke="#fff" strokeWidth="2" opacity=".8" />
                  <path d="M-22 356 Q0 349 22 356 L29 369 Q0 380 -29 369Z" fill="#d5dfd5" />
                  <g className="roof-tilt" style={{ transform: `rotate(${angle}deg)`, transformOrigin: '0px 230px' }}>
                    <path d="M-252 212 C-231 166 -162 136 -77 125 C-37 120 -22 92 0 86 C22 92 37 120 77 125 C162 136 231 166 252 212 Q256 224 241 226 Q0 206 -241 226 Q-256 224 -252 212Z" fill="url(#roof)" stroke="#f9fbf3" strokeWidth="3" />
                    <path d="M-235 208 C-203 166 -128 146 -64 137 Q-26 132 0 103 Q26 132 64 137 C128 146 203 166 235 208 Q0 190 -235 208Z" fill="url(#panels)" opacity=".82" />
                    <path d="M-236 211 Q0 194 236 211" fill="none" stroke="#638f88" strokeWidth="2" opacity=".65" />
                    <g className={`petals ${activeNight ? 'bloom' : ''}`}>{Array.from({ length: 8 }, (_, i) => <path key={i} d="M-4 111 Q-12 88 -8 70 Q-1 81 4 111Z" transform={`rotate(${i * 45} 0 113)`} fill={night ? '#d6e2d5' : '#eef2e6'} stroke="#aabdb0" strokeWidth=".8" opacity=".92" />)}</g>
                    <path d="M-222 214 Q0 196 222 214" fill="none" stroke={activeNight ? '#ffc969' : '#d5e8b0'} strokeWidth={activeNight ? '4' : '1.5'} filter={activeNight ? 'url(#glow)' : undefined} />
                  </g>
                  {[[-72, 238], [0, 242], [72, 238]].map(([x, y], i) => (
                    <g key={i} transform={`translate(${x} ${y})`}>
                      <circle r="15" fill="#425c56" stroke="#d4e2d9" strokeWidth="2" />
                      <g className={fansOn ? 'fan-spin' : ''}>
                        <path d="M0 -2 Q-3 -13 1 -12 Q6 -9 2 -2 Q13 -3 12 1 Q9 6 2 2 Q3 13 -1 12 Q-6 9 -2 2 Q-13 3 -12 -1 Q-9 -6 -2 -2Z" fill="#bad4cc" />
                        <circle r="2.5" fill="#f3f1dc" />
                      </g>
                      {fansOn && <path className="airflow" d="M-17 19 Q-25 32 -14 43 M0 19 Q-5 33 3 44 M17 19 Q24 32 15 43" />}
                    </g>
                  ))}
                </g>
                <g className="people">
                  <g transform="translate(321 372)"><circle cy="-17" r="6" fill="#604d39" /><path d="M-5 -10 L5 -10 L7 14 L-7 14Z" fill="#f1eee1" /><path d="M-4 13L-6 31M4 13L8 31" stroke="#43534a" strokeWidth="3" /></g>
                  <g transform="translate(575 382)"><circle cy="-17" r="6" fill="#493c32" /><path d="M-5 -10L5 -10L7 14L-7 14Z" fill="#d3a775" /><path d="M-4 13L-6 31M4 13L8 31" stroke="#43534a" strokeWidth="3" /></g>
                  <g transform="translate(388 376)"><circle cy="-15" r="5" fill="#7b5237" /><path d="M-5 -9L5 -9L7 13L-7 13Z" fill="#66816c" /><path d="M-4 12L-6 29M4 12L8 29" stroke="#455349" strokeWidth="3" /></g>
                </g>
                <g transform="translate(143 391)"><path d="M0 0V-20M30 0V-20M-4 -20H34M0 -29V-23M15 -29V-23M30 -29V-23" stroke="#8b6748" strokeWidth="4" /><path d="M-2 -20H32" stroke="#bf9b6c" strokeWidth="7" /></g>
                <g><rect x="30" y="26" width="138" height="34" rx="17" fill="#ffffff" opacity=".8" /><circle cx="49" cy="43" r="4" fill="#e8b647" /><text x="61" y="47" fontSize="11" fontWeight="700" fill="#48645c">{solar.toFixed(1)} kW SOLAR</text></g>
                {fansOn && <g><rect x="704" y="26" width="146" height="34" rx="17" fill="#ffffff" opacity=".82" /><circle cx="723" cy="43" r="4" fill="#59a887" /><text x="735" y="47" fontSize="11" fontWeight="700" fill="#48645c">COOLING ACTIVE</text></g>}
                {activeNight && <g><rect x="365" y="28" width="170" height="30" rx="15" fill="#243e45" opacity=".8" /><text x="450" y="47" textAnchor="middle" fontSize="10" fontWeight="700" letterSpacing="1.2" fill="#ffd88e">NIGHT BLOOM</text></g>}
              </svg>
            </div>

            <div className="telemetry-stats-grid">
              <div className="telemetry-stat-tile">
                <div className="tile-label">
                  <span>SOLAR</span>
                  <span className={`tile-state-pill ${energyState === 'Charging' ? 'charging' : 'discharging'}`}>
                    {energyState.toUpperCase()}
                  </span>
                </div>
                <div className="tile-value">
                  {solar.toFixed(1)} <small>kW</small>
                </div>
                <div className="tile-sub">Demand: {demand.toFixed(2)} kW</div>
              </div>

              <div className="telemetry-stat-tile">
                <div className="tile-label">
                  <span>BATTERY</span>
                  <span className="tile-state-pill">{runtime ? `${Math.floor(runtime / 60)}h ${runtime % 60}m` : '—'}</span>
                </div>
                <div className="tile-value">
                  {battery.toFixed(0)} <small>%</small>
                </div>
                <div className="tile-sub">Capacity: 48 kWh</div>
              </div>

              <div className="telemetry-stat-tile">
                <div className="tile-label">
                  <span>AMBIENT</span>
                  <Sun size={10} color="#fbbf24" />
                </div>
                <div className="tile-value">
                  {temperature} <small>°C</small>
                </div>
                <div className="tile-sub">Sunlight: {sunlight}%</div>
              </div>

              <div className="telemetry-stat-tile">
                <div className="tile-label">
                  <span>COOLING</span>
                  <Fan size={10} color={fansOn ? '#34d399' : '#6b7785'} />
                </div>
                <div className="tile-value" style={{ fontSize: '13px' }}>
                  {fansOn ? effectiveSpeed : 'Standby'}
                </div>
                <div className="tile-sub">{fansOn ? `${(fanKw * 1000).toFixed(0)} W` : `Triggers @ ${threshold}°C`}</div>
              </div>
            </div>
          </aside>
        </section>

        {/* LOWER SECTION: 4 DISTINCT COLORED BLOCKS */}
        <section className="unified-dashboard">
          <div className="dashboard-blocks-grid">

            {/* BLOCK 1: CORAL - Solar & Energy */}
            <div className="dash-block block-coral" id="block-coral">
              <div className="dash-block-head">
                <div className="dash-block-title">
                  <Zap size={13} />
                  <span>SOLAR &amp; ENERGY</span>
                </div>
                <span className="dash-block-badge">
                  {energyState === 'Charging' ? '↗ CHARGING' : energyState === 'Discharging' ? '↘ DISCHARGING' : '● BALANCED'}
                </span>
              </div>

              {/* Solar & Demand Stats */}
              <div className="block-subcard" style={{ gap: '3px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <span style={{ fontSize: '7.5px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Solar Gen</span>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--coral-accent)', lineHeight: 1.1 }}>
                      {solar.toFixed(1)} <small style={{ fontSize: '9px', color: 'var(--text-muted)' }}>kW</small>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '7.5px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Load Demand</span>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: '#f0f4f8', lineHeight: 1.1 }}>
                      {demand.toFixed(2)} <small style={{ fontSize: '9px', color: 'var(--text-muted)' }}>kW</small>
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: '7px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>18 kW Installed capacity</span>
                  <span>{lighting > 0 ? '+0.24 kW Bloom Lights' : 'Day lighting off'}</span>
                </div>
              </div>

              {/* AreaChart: Solar vs Demand */}
              <div className="block-subcard" style={{ flex: 1, padding: '3px 5px' }}>
                <div className="chart-header-row">
                  <span>Generation vs Demand</span>
                  <div className="chart-legend-pills">
                    <span><i className="dot-coral" /> Solar</span>
                    <span><i className="dot-ice" /> Demand</span>
                  </div>
                </div>
                <div className="mini-chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: -28 }}>
                      <defs>
                        <linearGradient id="coralSolarFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#ff6e4e" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#ff6e4e" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#242932" vertical={false} />
                      <XAxis dataKey="time" tick={{ fontSize: 7, fill: '#6b7785' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 7, fill: '#6b7785' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#191c22', border: '1px solid #323843', fontSize: '9px' }} />
                      <Area type="monotone" dataKey="solar" stroke="#ff6e4e" strokeWidth={1.5} fill="url(#coralSolarFill)" />
                      <Line type="monotone" dataKey="demand" stroke="#7de3f4" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Battery Start Slider & Capacity */}
              <div className="block-subcard">
                <div className="block-field">
                  <div className="field-header">
                    <span>Scenario Battery Start</span>
                    <b>{batteryStart}%</b>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={batteryStart}
                    onChange={e => {
                      const v = +e.target.value;
                      setBatteryStart(v);
                      setBattery(v);
                    }}
                    aria-label="Scenario battery start percentage"
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  <span>Capacity: <b>48 kWh</b></span>
                  <span>Est. Runtime: <b>{runtime ? `${Math.floor(runtime / 60)}h ${runtime % 60}m` : '—'}</b></span>
                </div>
              </div>
            </div>

            {/* BLOCK 2: ICE BLUE - Canopy & Shading */}
            <div className="dash-block block-ice" id="block-ice">
              <div className="dash-block-head">
                <div className="dash-block-title">
                  <Compass size={13} />
                  <span>CANOPY &amp; SHADING</span>
                </div>
                <span className="dash-block-badge">
                  {angleMode.toUpperCase()} MODE
                </span>
              </div>

              {/* Adaptive Shading Switch */}
              <div className="block-subcard">
                <div className="switch-row">
                  <div className="switch-label-group">
                    <b>Adaptive Sun Shading</b>
                    <span className="field-subtext">Ground-shade optimization</span>
                  </div>
                  <button
                    className={`toggle-switch ${adaptiveEnabled ? 'on' : ''}`}
                    onClick={toggleAdaptiveShading}
                    aria-label="Toggle adaptive shade optimization"
                  >
                    <i />
                  </button>
                </div>
              </div>

              {/* Canopy Tilt Slider */}
              <div className="block-subcard">
                <div className="block-field">
                  <div className="field-header">
                    <span>Canopy Tilt Angle</span>
                    <b>{angle > 0 ? '+' : ''}{angle.toFixed(1)}°</b>
                  </div>
                  <input
                    type="range"
                    min={CANOPY_TILT_LIMITS.min}
                    max={CANOPY_TILT_LIMITS.max}
                    value={angleMode === 'Auto' ? angle : manualAngle}
                    disabled={angleMode === 'Auto'}
                    onPointerDown={angleMode === 'Manual' ? beginShadeSliderInteraction : undefined}
                    onKeyDown={angleMode === 'Manual' ? handleShadeSliderKeyDown : undefined}
                    onChange={e => setManualAngle(+e.target.value)}
                    aria-label="Canopy tilt angle"
                  />
                  <div className="slider-ticks">
                    <span>{CANOPY_TILT_LIMITS.min}°</span>
                    <span>0°</span>
                    <span>+{CANOPY_TILT_LIMITS.max}°</span>
                  </div>
                </div>
              </div>

              {/* Roof Heading Slider */}
              <div className="block-subcard">
                <div className="block-field">
                  <div className="field-header">
                    <span>Roof Heading (Yaw)</span>
                    <button className="mode-badge-btn" onClick={toggleRoofHeadingMode} title="Toggle heading auto/manual">
                      {headingMode}
                    </button>
                    <b>{heading.toFixed(0)}°</b>
                  </div>
                  <input
                    aria-label="Roof heading angle"
                    type="range"
                    min="-90"
                    max="90"
                    value={headingMode === 'Auto' ? heading : manualHeading}
                    disabled={headingMode === 'Auto'}
                    onPointerDown={headingMode === 'Manual' ? beginShadeSliderInteraction : undefined}
                    onKeyDown={headingMode === 'Manual' ? handleShadeSliderKeyDown : undefined}
                    onChange={e => setManualHeading(+e.target.value)}
                  />
                  <div className="slider-ticks">
                    <span>-90° (West)</span>
                    <span>0° (South)</span>
                    <span>+90° (East)</span>
                  </div>
                </div>
              </div>

              {/* Ground Shade Coverage & Actions */}
              <div className="block-subcard" style={{ gap: '3px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7.5px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Occupied Ground Shade{shadeUpdating && <small> · Updating…</small>}</span>
                  <b style={{ color: 'var(--ice-accent)' }}>{shade ? (shade.directSunAvailable ? `${shade.coveragePercent}%` : 'Direct sun unavailable') : 'Calculating…'}</b>
                </div>
                <div className="progress-bar-wrap">
                  <div className="progress-bar-fill fill-ice" style={{ width: `${shade?.coveragePercent ?? 0}%` }} />
                </div>
                <div style={{ fontSize: '6.8px', color: 'var(--text-muted)' }} role="status" aria-live="polite">
                  {sunPosition.rawElevation <= 0 ? 'Night: direct sun unavailable' : occupancy === 0 ? 'No seated visitors' : `Person-level estimate: ${personShade}% (${occupancy} seated)`}
                </div>
                <div className="block-action-row" style={{ marginTop: '2px', justifyContent: 'space-between' }}>
                  <button className={`btn-bloom ${preview ? 'active' : ''}`} onClick={() => setPreview(!preview)}>
                    <Lightbulb size={11} /> {preview ? 'Exit Bloom' : 'Night Bloom'}
                  </button>
                  <span style={{ fontSize: '6px', color: 'var(--text-muted)' }}>±30° provisional test limit</span>
                </div>
              </div>

              {/* Optimizer Status */}
              <div className="optimizer-compact-card" role="status" aria-live="polite">
                <div className="opt-head-row">
                  <b>SHADE OPTIMIZER</b>
                  <span className={`opt-pill ${adaptiveEnabled ? adaptiveShadeState.status : 'manual'}`}>
                    {adaptiveEnabled ? adaptiveShadeState.status.toUpperCase() : 'MANUAL'}
                  </span>
                </div>
                {adaptiveEnabled && adaptiveShadeState.status === 'searching' && (
                  <div className="opt-detail-text">Evaluating {adaptiveProgress.evaluated} of {adaptiveProgress.total || 169} positions…{adaptiveSearchQueued ? ' Sun move queued.' : ''}</div>
                )}
                {adaptiveEnabled && adaptiveShadeState.status === 'idle' && (
                  <div className="opt-detail-text">Tracking sun baseline; awaiting next &gt;3° shift.</div>
                )}
                {adaptiveEnabled && adaptiveShadeState.status === 'no-sun' && (
                  <div className="opt-detail-text">Sun below horizon; canopy parked at neutral.</div>
                )}
                {adaptiveEnabled && adaptiveShadeState.status === 'error' && (
                  <div className="opt-detail-text error">Error: {adaptiveShadeState.message}</div>
                )}
                {adaptiveEnabled && adaptiveShadeState.status === 'applied' && (
                  <div className="opt-detail-text success">Refined target: H {adaptiveShadeState.heading.toFixed(0)}°, T {adaptiveShadeState.tilt.toFixed(0)}° ({adaptiveShadeState.coveragePercent.toFixed(1)}% shade, +{adaptiveShadeState.improvementPercent.toFixed(1)}%).</div>
                )}
                {adaptiveEnabled && adaptiveShadeState.status === 'held' && (
                  <div className="opt-detail-text">Holding H {adaptiveShadeState.heading.toFixed(0)}°, T {adaptiveShadeState.tilt.toFixed(0)}° ({adaptiveShadeState.coveragePercent.toFixed(1)}% shade). Gain &lt; 1%.</div>
                )}
                {!adaptiveEnabled && (
                  <div className="opt-detail-text">Manual override active; automated search paused.</div>
                )}
              </div>
            </div>

            {/* BLOCK 3: PERIWINKLE - Battery & Visitors */}
            <div className="dash-block block-periwinkle" id="block-periwinkle">
              <div className="dash-block-head">
                <div className="dash-block-title">
                  <BatteryCharging size={13} />
                  <span>BATTERY &amp; VISITORS</span>
                </div>
                <span className="dash-block-badge">
                  {battery.toFixed(0)}% CHARGED
                </span>
              </div>

              {/* Battery State Bar */}
              <div className="block-subcard" style={{ gap: '3px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '7.5px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Battery Storage</span>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--periwinkle-accent)' }}>
                    {battery.toFixed(0)}%
                  </div>
                </div>
                <div className="progress-bar-wrap">
                  <div className="progress-bar-fill fill-periwinkle" style={{ width: `${battery}%` }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7px', color: 'var(--text-muted)' }}>
                  <span>48 kWh Total</span>
                  <span>{runtime ? `${Math.floor(runtime / 60)}h ${runtime % 60}m remaining` : 'No demand'}</span>
                </div>
              </div>

              {/* Seated Occupancy Slider & Visitor Dots */}
              <div className="block-subcard">
                <div className="block-field">
                  <div className="field-header">
                    <span>Seated Visitors</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div className="visitor-dots">
                        {Array.from({ length: 8 }, (_, i) => (
                          <span key={i} className={`visitor-dot ${i < occupancy ? 'active' : ''}`} />
                        ))}
                      </div>
                      <b>{occupancy} / 8</b>
                    </div>
                  </div>
                  <input
                    aria-label="Seated visitors occupancy"
                    type="range"
                    min="0"
                    max="8"
                    value={occupancy}
                    onChange={e => setOccupancy(+e.target.value)}
                  />
                </div>
              </div>

              {/* LineChart: Battery & Canopy Angle */}
              <div className="block-subcard" style={{ flex: 1, padding: '3px 5px' }}>
                <div className="chart-header-row">
                  <span>Charge &amp; Angle History</span>
                  <div className="chart-legend-pills">
                    <span><i className="dot-periwinkle" /> Battery</span>
                    <span><i className="dot-sage" /> Angle</span>
                  </div>
                </div>
                <div className="mini-chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: -26 }}>
                      <CartesianGrid stroke="#242932" vertical={false} />
                      <XAxis dataKey="time" tick={{ fontSize: 7, fill: '#6b7785' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 7, fill: '#6b7785' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#191c22', border: '1px solid #323843', fontSize: '9px' }} />
                      <Line type="monotone" dataKey="battery" stroke="#7c88ff" strokeWidth={1.5} dot={false} />
                      <Line type="monotone" dataKey="angle" stroke="#96c49c" strokeWidth={1.2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Live Activity Stream */}
              <div className="block-subcard" style={{ gap: '2px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  <span>Live Activity Stream</span>
                  <span style={{ fontSize: '6.5px', color: 'var(--text-muted)' }}>{events.length} logged</span>
                </div>
                <div className="activity-stream">
                  {events.slice(0, 3).map((e, i) => (
                    <div className="activity-item" key={`${e}-${i}`}>
                      <span className="activity-dot" style={{ background: i === 0 ? 'var(--periwinkle-accent)' : i === 1 ? '#fbbf24' : '#6b7785' }} />
                      <span className="activity-text">{e}</span>
                      <time>{i === 0 ? 'NOW' : `${i * 2 + 1}m`}</time>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* BLOCK 4: SAGE GREEN - Environment & Cooling */}
            <div className="dash-block block-sage" id="block-sage">
              <div className="dash-block-head">
                <div className="dash-block-title">
                  <Fan size={13} />
                  <span>ENVIRONMENT &amp; COOLING</span>
                </div>
                <span className="dash-block-badge">
                  {fansOn ? `${effectiveSpeed.toUpperCase()} COOLING` : 'STANDBY'}
                </span>
              </div>

              {/* Time of Day Slider */}
              <div className="block-subcard">
                <div className="block-field">
                  <div className="field-header">
                    <span>Time of Day (MYT)</span>
                    <b style={{ color: 'var(--sage-accent)' }}>{fmtTime(minute)}</b>
                  </div>
                  <input
                    {...timeSliderProps}
                    aria-label="Time of day (MYT, UTC+8)"
                    type="range"
                    min="0"
                    max="1439"
                    value={minute}
                    onChange={e => setClock(+e.target.value)}
                  />
                  <div className="slider-ticks">
                    <span>00:00</span>
                    <span>06:00</span>
                    <span>12:00</span>
                    <span>18:00</span>
                    <span>24:00</span>
                  </div>
                </div>
              </div>

              {/* Sunlight & Temperature Controls */}
              <div className="block-subcard" style={{ gap: '4px' }}>
                <div className="block-field">
                  <div className="field-header">
                    <span>Sunlight Intensity</span>
                    <b>{sunlight}%</b>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={sunlight}
                    onChange={e => setSunlight(+e.target.value)}
                    aria-label="Sunlight intensity"
                  />
                </div>

                <div className="block-field">
                  <div className="field-header">
                    <span>Ambient Temperature</span>
                    <b>{temperature}°C</b>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="42"
                    value={temperature}
                    onPointerDown={angleMode === 'Auto' ? beginShadeSliderInteraction : undefined}
                    onKeyDown={angleMode === 'Auto' ? handleShadeSliderKeyDown : undefined}
                    onChange={e => setTemperature(+e.target.value)}
                    aria-label="Ambient temperature"
                  />
                </div>
              </div>

              {/* Cooling Fan Mode & Speed Controls */}
              <div className="block-subcard" style={{ gap: '3px' }}>
                <div className="switch-row">
                  <div className="switch-label-group">
                    <b>Automatic Cooling Fans</b>
                    <span className="field-subtext">Triggers at &gt;{threshold}°C (1.5° hysteresis)</span>
                  </div>
                  <button
                    className={`toggle-switch ${fanMode === 'Auto' ? 'on' : ''}`}
                    onClick={() => setFanMode(fanMode === 'Auto' ? 'Manual' : 'Auto')}
                    aria-label="Toggle automatic fan mode"
                  >
                    <i />
                  </button>
                </div>

                {fanMode === 'Manual' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '7.5px', marginTop: '2px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Manual Fan Request</span>
                    <button
                      className="mode-badge-btn"
                      style={{ background: manualFan ? 'var(--sage-accent)' : undefined, color: manualFan ? '#111' : undefined }}
                      onClick={() => setManualFan(!manualFan)}
                    >
                      {manualFan ? 'RUNNING' : 'OFF'}
                    </button>
                  </div>
                )}

                <div className="block-field" style={{ marginTop: '2px' }}>
                  <div className="field-header">
                    <span>Activation Threshold</span>
                    <b>{threshold}°C</b>
                  </div>
                  <input
                    type="range"
                    min="24"
                    max="38"
                    value={threshold}
                    onChange={e => setThreshold(+e.target.value)}
                    aria-label="Fan activation temperature threshold"
                  />
                </div>

                <div className="fan-speed-pills">
                  {(['Low', 'Medium', 'High'] as FanSpeed[]).map(s => (
                    <button
                      key={s}
                      onClick={() => setFanSpeed(s)}
                      className={`fan-speed-pill ${fanSpeed === s ? 'selected' : ''}`}
                    >
                      {s} ({FAN_POWER_KW[s]}kW)
                    </button>
                  ))}
                </div>

                {battery < 12 && (
                  <div style={{ fontSize: '6.5px', color: '#fbbf24', background: 'rgba(251, 191, 36, 0.1)', padding: '2px 4px', borderRadius: '3px', marginTop: '2px' }}>
                    Low battery: fan power capped at Low speed
                  </div>
                )}
              </div>

              {/* Location Coordinates */}
              <div className="block-subcard">
                <div className="loc-grid-compact">
                  <label>
                    Date
                    <input type="date" value={simDate} onChange={e => setSimDate(e.target.value)} aria-label="Simulation date" />
                  </label>
                  <label>
                    Lat
                    <input type="number" min="-89" max="89" step=".001" value={latitude} onChange={e => setLatitude(+e.target.value)} aria-label="Latitude" />
                  </label>
                  <label>
                    Lon
                    <input type="number" min="-180" max="180" step=".001" value={longitude} onChange={e => setLongitude(+e.target.value)} aria-label="Longitude" />
                  </label>
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* Footer Bar */}
        <footer className="app-footer">
          <div className="footer-left">
            <Leaf size={12} color="#34d399" />
            <span className="footer-brand">ecobloom</span>
            <span>· Smart solar-shading canopy simulation</span>
          </div>
          <div>
            <span>MODEL V1.0 · ALL SENSORS &amp; TELEMETRY ONLINE</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
