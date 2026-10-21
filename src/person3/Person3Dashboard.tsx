import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle, BatteryCharging, CalendarDays, Clock3, Fan, Leaf,
  Lightbulb, Pause, Play, RotateCcw, ShieldCheck, SlidersHorizontal,
  Sun, Users, Wind, Zap,
} from 'lucide-react';
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { CanopyScene } from '../park/CanopyScene';
import {
  advanceBattery, calculateDemoOutput, defaultInputs, formatTime,
  makeDayProfile, DEMO_BATTERY_CAPACITY_KWH, DEMO_WIND_LIMIT_MS,
} from './simulatorAdapter';
import type {
  DashboardInputs, EnergyPoint, FanMode, OperatingMode, PlaybackSpeed,
} from './simulatorAdapter';
import './person3.css';

type IconType = typeof Sun;

type Scenario = 'hot' | 'wind' | 'evening' | 'vacant';
const SCENARIOS: { key: Scenario; title: string; details: string }[] = [
  { key: 'hot', title: 'Hot afternoon', details: 'Strong sun & high demand' },
  { key: 'wind', title: 'Strong wind', details: 'Safety override demonstration' },
  { key: 'evening', title: 'Evening', details: 'Lighting & discharge' },
  { key: 'vacant', title: 'No visitors', details: 'Occupancy-responsive cooling' },
];

function NumericMetric({ icon: Icon, label, value, detail }: {
  icon: IconType; label: string; value: string; detail: string;
}) {
  return (
    <article className="p3-metric">
      <span className="p3-metric-icon"><Icon size={19} /></span>
      <div><div className="p3-overline">{label}</div>
        <strong>{value}</strong><small>{detail}</small></div>
    </article>
  );
}

function RangeField({ label, valueLabel, min, max, step = 1, value, onChange, disabled = false, hint }: {
  label: string; valueLabel: string; min: number; max: number; step?: number;
  value: number; onChange: (value: number) => void; disabled?: boolean; hint?: string;
}) {
  return <label className={`p3-field ${disabled ? 'p3-disabled' : ''}`}>
    <span className="p3-field-head"><span>{label}</span><b>{valueLabel}</b></span>
    <input type="range" min={min} max={max} step={step} value={value}
      disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    {hint && <small>{hint}</small>}
  </label>;
}

function ToggleGroup<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly T[]; onChange: (value: T) => void;
}) {
  return <div className="p3-field"><span className="p3-field-head">{label}</span>
    <div className="p3-toggle-group" role="group" aria-label={label}>
      {options.map(option => <button key={option} type="button" className={option === value ? 'p3-chosen' : ''}
        aria-pressed={option === value} onClick={() => onChange(option)}>{option}</button>)}
    </div>
  </div>;
}

function Section({ title, subtitle, icon: Icon, children }: {
  title: string; subtitle?: string; icon: IconType; children: ReactNode;
}) {
  return <section className="p3-card p3-section">
    <div className="p3-section-title"><span className="p3-section-icon"><Icon size={18} /></span>
      <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>
    {children}
  </section>;
}

export default function Person3Dashboard() {
  const [inputs, setInputs] = useState<DashboardInputs>(defaultInputs);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [history, setHistory] = useState<EnergyPoint[]>([]);
  const [eventLog, setEventLog] = useState<string[]>([
    'EcoBloom dashboard initialized with demonstration data.',
  ]);

  const patch = <K extends keyof DashboardInputs>(key: K, value: DashboardInputs[K]) => {
    setInputs(prev => ({ ...prev, [key]: value }));
    setSelectedScenario(null);
  };
  const output = useMemo(() => calculateDemoOutput(inputs), [inputs]);
  const forecast = useMemo(() => makeDayProfile(inputs), [inputs]);

  const note = (message: string) => setEventLog(prev => [message, ...prev].slice(0, 6));
  const loadScenario = (scenario: Scenario) => {
    const initial = defaultInputs();
    const scenarios: Record<Scenario, Partial<DashboardInputs>> = {
      hot: { minute: 14 * 60, temperature: 36, windSpeed: 3, sunlight: 96, occupancy: 5, battery: 65 },
      wind: { minute: 13 * 60, temperature: 32, windSpeed: 15, sunlight: 86, occupancy: 4, battery: 76 },
      evening: { minute: 20 * 60, temperature: 28, windSpeed: 2, sunlight: 0, occupancy: 3, battery: 52 },
      vacant: { minute: 11 * 60, temperature: 34, windSpeed: 2, sunlight: 90, occupancy: 0, battery: 78 },
    };
    setInputs({ ...initial, date: inputs.date, latitude: inputs.latitude,
      longitude: inputs.longitude, ...scenarios[scenario] });
    setSelectedScenario(scenario);
    setHistory([]);
    setPlaying(false);
    note(`Scenario loaded: ${SCENARIOS.find(s => s.key === scenario)?.title}.`);
  };
  const reset = () => {
    setInputs(defaultInputs()); setPlaying(false); setSpeed(1);
    setSelectedScenario(null); setHistory([]);
    setEventLog(['Dashboard reset to initial demonstration values.']);
  };

  // Playback advances simulated time by 5/10/20 min each tick.
  // Dragging the time slider does NOT imply battery charging for the skipped time.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const snapshot = calculateDemoOutput(inputs);
      const step = 5 * speed;
      const nextMinute = (inputs.minute + step) % 1440;
      const nextBattery = advanceBattery(
        inputs.battery, snapshot.solarKw, snapshot.demandKw, step,
      );
      setInputs({ ...inputs, minute: nextMinute, battery: nextBattery });
      setHistory(previous => [...previous.slice(-47), {
        time: formatTime(nextMinute), solar: +snapshot.solarKw.toFixed(2),
        demand: +snapshot.demandKw.toFixed(2), battery: +nextBattery.toFixed(1),
      }]);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [playing, speed, inputs]);

  const setMode = (value: OperatingMode) => {
    patch('mode', value); note(`Roof operating mode changed to ${value}.`);
  };
  const setFanMode = (value: FanMode) => {
    patch('fanMode', value); note(`Fan operating mode changed to ${value}.`);
  };
  const batteryPct = Math.round(inputs.battery);
  const batteryStatus = output.energyState === 'Charging' ? 'Solar surplus' :
    output.energyState === 'Discharging' ? 'Using stored energy' : 'Energy balanced';

  return <div className="p3-app">
    <header className="p3-topbar">
      <div className="p3-brand">
        <div className="p3-logo"><Leaf size={22} /></div>
        <div><strong>EcoBloom <span>/ EcoCanopy</span></strong><small>SMART SOLAR PARK SIMULATOR</small></div>
      </div>
      <div className="p3-top-actions">
        <span className={`p3-pill ${output.windAlert ? 'p3-danger' : 'p3-good'}`}>
          {output.windAlert ? <AlertTriangle size={14} /> : <ShieldCheck size={14} />}
          {output.operatingState}
        </span>
        <span className="p3-clock"><Clock3 size={15} /> {formatTime(inputs.minute)}</span>
        <button className="p3-icon-button" title={playing ? 'Pause playback' : 'Start playback'}
          aria-label={playing ? 'Pause playback' : 'Start playback'} onClick={() => setPlaying(value => !value)}>
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button className="p3-icon-button" title="Reset simulation" aria-label="Reset simulation"
          onClick={reset}><RotateCcw size={17} /></button>
      </div>
    </header>

    <div className="p3-hero">
      <div><span className="p3-eyebrow">THE SUSTAINABLE PUBLIC SPACE CONCEPT</span>
        <h1>Control shade. Harness sunshine.</h1>
        <p>An interactive demonstration of adaptive shading, cooling and renewable energy.</p>
      </div>
      <span className="p3-demo-tag">● INTERACTIVE DEMO <small>Illustrative, not a physical sensor feed</small></span>
    </div>

    <div className="p3-dashboard-grid">
      <section className="p3-card p3-viewer">
        <div className="p3-card-heading"><div><span className="p3-overline">LIVE 3D VIEW</span><h2>EcoCanopy 01</h2></div>
          <span className="p3-online">● Scene connected</span></div>
        <div className="p3-scene scene-card">
          <CanopyScene heading={output.heading} tilt={output.tilt}
            sunDirection={output.sunDirection}
            fansOn={output.fansOn} night={output.night}
            occupancy={inputs.occupancy} />
        </div>
        <div className="p3-viewer-footer">
          <span><Sun size={15} /> Sun azimuth <b>{output.sunAzimuth.toFixed(0)}°</b></span>
          <span><RotateCcw size={15} /> Heading <b>{output.heading.toFixed(1)}°</b></span>
          <span>Roof tilt <b>{output.tilt.toFixed(1)}°</b></span>
        </div>
      </section>

      <aside className="p3-sidebar">
        <Section title="Quick scenarios" subtitle="One click to demonstrate an outcome" icon={SlidersHorizontal}>
          <div className="p3-scenarios">
            {SCENARIOS.map(s => <button type="button" key={s.key}
              className={selectedScenario === s.key ? 'p3-active-scenario' : ''}
              onClick={() => loadScenario(s.key)}><strong>{s.title}</strong><small>{s.details}</small></button>)}
          </div>
        </Section>
        <Section title="Environment" subtitle="Adjust the conditions in real time" icon={Sun}>
          <RangeField label="Time of day (MYT)" valueLabel={formatTime(inputs.minute)} min={0} max={1439}
            step={5} value={inputs.minute} onChange={v => patch('minute', v)} />
          <RangeField label="Temperature" valueLabel={`${inputs.temperature} °C`} min={20} max={42}
            value={inputs.temperature} onChange={v => patch('temperature', v)} />
          <RangeField label="Wind speed" valueLabel={`${inputs.windSpeed} m/s`} min={0} max={20}
            value={inputs.windSpeed} onChange={v => patch('windSpeed', v)}
            hint={`Demo safety threshold: ${DEMO_WIND_LIMIT_MS} m/s`} />
          <RangeField label="Sunlight intensity" valueLabel={`${inputs.sunlight}%`} min={0} max={100}
            value={inputs.sunlight} onChange={v => patch('sunlight', v)} />
          <RangeField label="Occupancy" valueLabel={`${inputs.occupancy} people`} min={0} max={8}
            value={inputs.occupancy} onChange={v => patch('occupancy', v)} />
          <div className="p3-location-fields">
            <label><CalendarDays size={13} /> Simulation date<input type="date" value={inputs.date}
              onChange={event => patch('date', event.target.value || inputs.date)} /></label>
            <label>Latitude<input type="number" min={-89} max={89} step={0.001} value={inputs.latitude}
              onChange={event => patch('latitude', Math.max(-89, Math.min(89, Number(event.target.value))))} /></label>
            <label>Longitude<input type="number" min={-180} max={180} step={0.001} value={inputs.longitude}
              onChange={event => patch('longitude', Math.max(-180, Math.min(180, Number(event.target.value))))} /></label>
          </div>
        </Section>
      </aside>
    </div>

    <div className="p3-metrics-grid">
      <NumericMetric icon={Sun} label="SHADE COVERAGE" value={`${output.shade}%`} detail="Estimated seating area" />
      <NumericMetric icon={BatteryCharging} label="BATTERY LEVEL" value={`${batteryPct}%`} detail={batteryStatus} />
      <NumericMetric icon={Zap} label="SOLAR GENERATION" value={`${output.solarKw.toFixed(2)} kW`} detail="Estimated instantaneous output" />
      <NumericMetric icon={Fan} label="COOLING FANS" value={output.fansOn ? 'ON' : 'OFF'}
        detail={output.fansOn ? '0.56 kW estimated load' : 'Cooling standby'} />
    </div>

    <div className="p3-controls-grid">
      <Section title="Canopy operation" subtitle="Automatic or manual roof control" icon={RotateCcw}>
        <ToggleGroup label="Roof control" value={inputs.mode} options={['AUTO', 'MANUAL', 'OFF'] as const} onChange={setMode} />
        <RangeField label="Roof heading" valueLabel={`${output.heading.toFixed(1)}°`} min={-90} max={90}
          value={inputs.mode === 'MANUAL' ? inputs.manualHeading : Math.round(output.heading)}
          disabled={inputs.mode !== 'MANUAL' || output.windAlert}
          onChange={v => patch('manualHeading', v)}
          hint="Adjustable in MANUAL mode; wind safety takes priority." />
        <RangeField label="Roof tilt" valueLabel={`${output.tilt.toFixed(1)}°`} min={-15} max={15}
          value={inputs.mode === 'MANUAL' ? inputs.manualTilt : Math.round(output.tilt)}
          disabled={inputs.mode !== 'MANUAL' || output.windAlert}
          onChange={v => patch('manualTilt', v)} />
        <div className="p3-shade-meter"><span>Seating shade <b>{output.shade}%</b></span>
          <div><i style={{ width: `${output.shade}%` }} /></div></div>
      </Section>
      <Section title="Cooling & energy" subtitle="Occupancy-responsive comfort control" icon={Fan}>
        <ToggleGroup label="Fan control" value={inputs.fanMode} options={['AUTO', 'ON', 'OFF'] as const} onChange={setFanMode} />
        <RangeField label="Battery level (starting value)" valueLabel={`${batteryPct}%`} min={0} max={100}
          value={batteryPct} onChange={v => patch('battery', v)} />
        <div className="p3-energy-rows">
          <div><span>System consumption</span><strong>{output.demandKw.toFixed(2)} kW</strong></div>
          <div><span>LED lighting</span><strong>{output.lightsOn ? 'ON' : 'OFF'}</strong></div>
          <div><span>Energy balance</span><strong>{(output.solarKw - output.demandKw).toFixed(2)} kW</strong></div>
          <div><span>Battery capacity assumption</span><strong>{DEMO_BATTERY_CAPACITY_KWH} kWh</strong></div>
        </div>
        <div className="p3-speed-row"><span>Playback speed</span>
          <div className="p3-toggle-group" role="group" aria-label="Playback speed">
            {([1, 2, 4] as PlaybackSpeed[]).map(s => <button key={s} aria-pressed={speed === s}
              className={speed === s ? 'p3-chosen' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}
          </div>
        </div>
      </Section>
      <Section title="System intelligence" subtitle="Why EcoCanopy made this decision" icon={ShieldCheck}>
        <div className={`p3-status-box ${output.windAlert ? 'p3-status-danger' : ''}`}>
          {output.windAlert ? <AlertTriangle size={20} /> : <ShieldCheck size={20} />}
          <div><strong>{output.operatingState}</strong><p>{output.reason}</p></div>
        </div>
        <div className="p3-energy-rows">
          <div><span>Wind safety</span><strong>{output.windAlert ? 'ACTIVE' : 'NORMAL'}</strong></div>
          <div><span>Mode</span><strong>{inputs.mode}</strong></div>
          <div><span>Sun elevation</span><strong>{output.sunElevation.toFixed(1)}°</strong></div>
        </div>
        <h3 className="p3-log-title">Recent actions</h3>
        <ul className="p3-log">{eventLog.map((text, index) => <li key={`${index}-${text}`}>{text}</li>)}</ul>
      </Section>
    </div>

    <div className="p3-charts-grid">
      <Section title="Daily energy profile" subtitle="Estimated generation vs. demand throughout the day" icon={Zap}>
        <div className="p3-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={forecast} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e6eee6" strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} interval={3} />
              <YAxis tick={{ fontSize: 11 }} unit="kW" />
              <Tooltip /><Legend />
              <Line dataKey="solar" name="Solar generation (kW)" type="monotone" stroke="#d4a74b" strokeWidth={2.6} dot={false} />
              <Line dataKey="demand" name="System demand (kW)" type="monotone" stroke="#39876c" strokeWidth={2.6} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Section>
      <Section title="Battery playback history" subtitle="Recorded battery level during simulation playback" icon={BatteryCharging}>
        {history.length < 2 ? <div className="p3-chart-empty"><BatteryCharging size={28} />
          <strong>No playback history yet</strong><p>Press the play button to record charging and discharging over simulated time.</p></div>
          : <div className="p3-chart"><ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e6eee6" strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} minTickGap={22} />
              <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line name="Battery (%)" dataKey="battery" type="monotone" stroke="#39876c" strokeWidth={2.7} dot={false} />
            </LineChart>
          </ResponsiveContainer></div>}
      </Section>
    </div>

    <footer className="p3-footer"><div><Leaf size={17} /> EcoBloom · Person 3 Dashboard</div>
      <p>All conditions, wind thresholds, battery behaviour and shade estimates are simulated. Not an engineering certification.</p>
    </footer>
  </div>;
}
