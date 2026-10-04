import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CircleCheck, RefreshCw, TriangleAlert } from 'lucide-react';
import { BarList, RainChart } from '../components/Charts';
import { AreaMap, type MapOverlay } from '../components/AreaMap';
import { ErrorState } from '../components/States';
import { Card, PageHeader } from '../components/ui';
import { timeOfDay } from '../lib/format';
import {
  RADAR_MAX_ZOOM, RADAR_SOURCE_URL, WEATHER_SOURCE_URL, clockLabel, conditionIcon, conditionLabel, dayName, hourLabel,
  isDaytime, weatherRisks, weatherUpdate, type RainHistory, type RainWindow, type Risk, type Weather,
} from '../lib/weather';
import { SEQUENTIAL_BLUE } from '../lib/scales';
import { useBarangays } from '../state/places';
import { useStats } from '../state/useStats';
import { useRadar, useRainHistory, useWeather, type Polled } from '../state/useWeather';
import type { Barangay } from '../lib/geo';
import { Segmented } from '../components/Segmented';
import { CountUp } from '../components/CountUp';

type RainMapMode = 'live' | RainWindow;
const MODES: { value: RainMapMode; label: string; span?: string }[] = [
  { value: 'live', label: 'Live radar' },
  { value: 'day', label: '24 hours', span: 'the last 24 hours' },
  { value: 'threeDays', label: '3 days', span: 'the last 3 days' },
  { value: 'week', label: '1 week', span: 'the last week' },
];

/** RainViewer's "Universal Blue" rain colours (their published colour table), light to heavy. */
const RADAR_LEGEND = [
  { color: '#cec087', label: 'Drizzle' }, { color: '#00a3e0', label: 'Light' }, { color: '#005588', label: 'Moderate' },
  { color: '#ffee00', label: 'Heavy' }, { color: '#ffaa00', label: 'Intense' }, { color: '#c10000', label: 'Torrential' },
];

/**
 * Live Makati weather, read for what it means for hazards. The rain map leads, with current
 * conditions beside it; then rain over the next day against street-level risk; then the week.
 */
export function WeatherPage() {
  const { weather, error, fetchedAt, loading, reload } = useWeather();
  const { stats } = useStats();
  const flooding = stats?.activeByType.find((t) => t.key === 'FLOODING')?.count ?? 0;
  const risks = useMemo(() => (weather ? weatherRisks(weather, flooding) : []), [weather, flooding]);
  const update = weather ? weatherUpdate(weather) : null;
  const barangays = useBarangays();
  const history = useRainHistory(barangays);

  return (
    <div className="page weather-page">
      <PageHeader title="Weather"
        subtitle={<>
          Makati City{' '}
          {weather && fetchedAt
            ? error
              ? <span className="weather-stale" role="status">· Couldn’t refresh, showing {timeOfDay(new Date(fetchedAt).toISOString())} data</span>
              : <>· Conditions as of {clockLabel(weather.current.time)}</>
            : loading ? <>· Loading live conditions…</> : null}
          {' '}· <a href={WEATHER_SOURCE_URL} target="_blank" rel="noreferrer">Open-Meteo</a>
        </>}
        actions={<button type="button" className="btn btn-secondary" onClick={reload} disabled={loading}>
          <RefreshCw size={15} aria-hidden="true" className={loading ? 'spinning' : undefined} />{loading ? 'Refreshing…' : 'Refresh'}
        </button>} />

      {!weather && error && <ErrorState title="We couldn’t load the weather." message={error} onRetry={reload} />}

      {update && (
        // Keyed on the level: becoming a watch replays the one-off tint, a new update slides in.
        <div key={update.watch ? 'watch' : 'update'} className={`weather-update${update.watch ? ' watch' : ''}`} role="status">
          <span className="weather-update-tag">{update.watch ? 'Weather watch' : 'Live update'}</span>
          <span className="weather-update-text">{update.text}</span>
          {update.watch && flooding > 0
            ? <Link to="/map?tab=active&type=FLOODING" className="btn-link">Flooding reports<ArrowRight size={14} aria-hidden="true" /></Link>
            : <a href="#forecast" className="btn-link">View forecast<ArrowRight size={14} aria-hidden="true" /></a>}
        </div>
      )}

      <section className="weather-hero">
        <RainMap risks={risks} barangays={barangays} history={history} />
        {weather ? <Conditions weather={weather} flood={risks[0]} /> : <div className="skeleton weather-skeleton" />}
      </section>

      {weather && <>
        <div className="grid-main-side" id="forecast">
          <Card title="Rain, next 24 hours" subtitle="Millimetres per hour">
            <RainChart hourly={weather.hourly} height={180} />
            {weather.hourly.every((h) => h.precipitation === 0) && <p className="muted chart-empty">No rain expected in the next 24 hours.</p>}
            <ol className="hour-cards" aria-label="Hourly forecast">
              {weather.hourly.map((h, i) => (
                <li key={h.time} className={i === 0 ? 'now' : undefined} style={{ '--i': Math.min(i, 12) } as CSSProperties}>
                  <span className="hour-time">{i === 0 ? 'Now' : hourLabel(h.time)}</span>
                  <span className="weather-icon" title={conditionLabel(h.code)}
                    dangerouslySetInnerHTML={{ __html: conditionIcon(h.code, isDaytime(h.time), 22) }} />
                  <strong>{Math.round(h.temperature)}°</strong>
                  <span className={`hour-chance${h.chance >= 60 ? ' wet' : ''}`}>{h.chance}%</span>
                </li>
              ))}
            </ol>
          </Card>
          <Card title="Weather-related risk" subtitle="For people walking, next 6 hours">
            <ul className="risk-list">
              {risks.map((r) => (
                <li key={r.key}>
                  <span className="risk-name">{r.label}<small>{r.note}</small></span>
                  <span className={`risk-level risk-${r.level.toLowerCase()}`}>{r.level}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card title="7-day forecast" subtitle="High and low, rain and chance of rain">
          <ol className="day-cells">
            {weather.daily.map((d, i) => (
              <li key={d.date} className={i === 0 ? 'today' : undefined} title={conditionLabel(d.code)} style={{ '--i': i } as CSSProperties}>
                <span className="day-name">{dayName(d.date, i)}</span>
                <span className="weather-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: conditionIcon(d.code, true, 28) }} />
                <span className="sr-only">{conditionLabel(d.code)}</span>
                <span className="day-temps"><strong>{Math.round(d.max)}°</strong><span>{Math.round(d.min)}°</span></span>
                <span className="day-rain">{d.precipitation.toFixed(1)} mm</span>
                <span className={`hour-chance${d.chance >= 60 ? ' wet' : ''}`}>{d.chance}%</span>
              </li>
            ))}
          </ol>
        </Card>
      </>}

      <RainByBarangay history={history} />
    </div>
  );
}

/** Current conditions, glass over the hero's soft sky. */
function Conditions({ weather, flood }: { weather: Weather; flood?: Risk }) {
  const c = weather.current;
  return (
    <aside className="conditions" aria-label="Current conditions">
      <p className="conditions-kicker">Current conditions</p>
      <div className="conditions-now">
        <span className="conditions-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: conditionIcon(c.code, c.isDay, 56, true) }} />
        <div>
          <div className="conditions-temp"><CountUp value={Math.round(c.temperature)} fromZero fadeLater />°C</div>
          <div className="conditions-label">{conditionLabel(c.code)}</div>
          <p className="muted small">Feels like {Math.round(c.feelsLike)}°C</p>
        </div>
      </div>
      <dl className="conditions-facts">
        <div><dt>Humidity</dt><dd>{c.humidity}%</dd></div>
        <div><dt>Wind</dt><dd>{Math.round(c.windSpeed)} km/h</dd></div>
        <div><dt>Gusts</dt><dd>{Math.round(c.windGusts)} km/h</dd></div>
        <div><dt>Rain, last 15 min</dt><dd>{c.precipitation.toFixed(1)} mm</dd></div>
        <div><dt>Heat index</dt><dd>{Math.round(c.feelsLike)}°C</dd></div>
      </dl>
      {flood && (
        <div className="conditions-flood" title={flood.note}>
          <span>Flood risk</span>
          <span className={`risk-level risk-${flood.level.toLowerCase()}`}>{flood.level}</span>
        </div>
      )}
    </aside>
  );
}

/** The rain map: live radar, or barangay totals for the last day, 3 days or week. Alerts float on it. */
function RainMap({ risks, barangays, history }: { risks: Risk[]; barangays: Barangay[]; history: Polled<RainHistory> }) {
  const radar = useRadar();
  const [mode, setMode] = useState<RainMapMode>('live');
  const live = mode === 'live';
  const areas = history.data?.areas ?? null;
  const values = (areas ?? []).map((a) => (live ? a.now : a[mode]));
  const max = values.length ? Math.max(...values) : 0;
  const shaded = useMemo(() => (areas && !live ? new Map(areas.map((a) => [a.name, a[mode]])) : null), [areas, live, mode]);
  const liveByName = useMemo(() => new Map((areas ?? []).map((a) => [a.name, a.now])), [areas]);
  const overlay: MapOverlay | null = live && radar.data ? {
    url: radar.data.tileUrl, attribution: `Radar: <a href="${RADAR_SOURCE_URL}">RainViewer</a>`,
    maxNativeZoom: RADAR_MAX_ZOOM + 1,
  } : null;
  const alerts = risks.filter((r) => r.level !== 'Low');

  return (
    <div className="rain-map">
      <AreaMap barangays={barangays} values={shaded} max={max} overlay={overlay}
        format={(v, name) => {
          if (live) {
            const now = liveByName.get(name);
            return now == null ? 'No data' : `${now.toFixed(1)} mm in the last 15 min (model)`;
          }
          return v == null ? 'No data' : `${v.toFixed(1)} mm`;
        }}
        label={live ? 'Live rain radar over Makati with barangay outlines'
          : 'Makati barangays shaded by rainfall; the list below the map has the same numbers'} />

      <Segmented className="rain-map-modes glass" label="Rain map" options={MODES} value={mode} onChange={setMode} />

      <div className={`weather-alert glass${alerts.length ? ' on' : ''}`} role="status">
        {alerts.length
          ? <>
            <TriangleAlert size={16} aria-hidden="true" />
            <span><strong>{alerts.length} weather {alerts.length === 1 ? 'watch' : 'watches'}</strong>
              {alerts.map((a) => <small key={a.key}>{a.label}: {a.level.toLowerCase()}</small>)}</span>
          </>
          : <><CircleCheck size={16} aria-hidden="true" /><span><strong>No active weather alerts</strong></span></>}
      </div>

      <div key={mode} className="rain-map-legend glass" aria-label={live ? 'Radar rain intensity' : 'Rainfall scale'}>
        {live
          ? radar.error && !radar.data
            ? <span className="weather-stale">Live radar unavailable</span>
            : <>
              {RADAR_LEGEND.map((l) => <span key={l.label}><i style={{ background: l.color }} />{l.label}</span>)}
              {radar.data && <span className="muted">· {radar.data.time.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })}</span>}
            </>
          : <>
            <span className="muted">0 mm</span>
            <span className="rain-ramp" style={{ background: `linear-gradient(90deg, ${SEQUENTIAL_BLUE.join(', ')})` }} />
            <span className="muted">{max.toFixed(1)} mm</span>
          </>}
      </div>
    </div>
  );
}

/** The map's numbers as a ranked list, for the past windows (where every barangay has a total). */
function RainByBarangay({ history }: { history: Polled<RainHistory> }) {
  const [mode, setMode] = useState<RainWindow>('day');
  const areas = history.data?.areas ?? null;
  const span = MODES.find((m) => m.value === mode)?.span;
  return (
    <Card title="Rain by barangay" subtitle={`Totals over ${span}. Weather models work on a grid a few kilometres wide, so neighbours often share a value.`}
      action={
        <Segmented className="segmented small" label="Period" value={mode}
          options={MODES.filter((m) => m.value !== 'live') as { value: RainWindow; label: string }[]} onChange={setMode} />
      }>
      {!areas && history.error
        ? <ErrorState title="We couldn’t load past rainfall." message={history.error} onRetry={history.reload} />
        : areas
          ? <div className="rain-columns">
            <BarList rows={[...areas].map((a) => ({ key: a.name, label: a.name, value: a[mode] })).sort((a, b) => b.value - a.value)}
              format={(n) => `${n.toFixed(1)} mm`} empty="No rain recorded in this period" />
          </div>
          : <div className="skeleton" style={{ height: 240 }} />}
    </Card>
  );
}
