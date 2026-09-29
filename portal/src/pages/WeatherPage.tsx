import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { BarList, RainChart } from '../components/Charts';
import { AreaMap, type MapOverlay } from '../components/AreaMap';
import { ErrorState } from '../components/States';
import { timeOfDay } from '../lib/format';
import {
  RADAR_MAX_ZOOM, RADAR_SOURCE_URL, WEATHER_SOURCE_URL, clockLabel, conditionIcon, conditionLabel, dayName, heatBand, hourLabel,
  isDaytime, rainBand, type Band, type RainWindow, type Weather,
} from '../lib/weather';
import { SEQUENTIAL_BLUE } from '../lib/scales';
import { useBarangays } from '../state/places';
import { useStats } from '../state/useStats';
import { useRadar, useRainHistory, useWeather } from '../state/useWeather';

/** Live Makati weather, read for what it means for hazards: rain brings flooding, heat affects walkers. */
export function WeatherPage() {
  const { weather, error, fetchedAt, loading, reload } = useWeather();
  const { stats } = useStats();
  const flooding = stats?.activeByType.find((t) => t.key === 'FLOODING')?.count;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Makati City</p>
          <h1>Weather</h1>
          <p className="muted">
            {weather && fetchedAt
              ? error
                ? <span className="weather-stale" role="status">Couldn’t refresh · showing {timeOfDay(new Date(fetchedAt).toISOString())} data</span>
                : <>Conditions as of {clockLabel(weather.current.time)} · checked {timeOfDay(new Date(fetchedAt).toISOString())}</>
              : loading ? 'Loading live conditions…' : null}
            {' · '}Weather data: <a href={WEATHER_SOURCE_URL} target="_blank" rel="noreferrer">Open-Meteo</a>
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={reload} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {!weather && error && <ErrorState title="We couldn’t load the weather." message={error} onRetry={reload} />}
      {!weather && !error && <WeatherSkeleton />}

      {weather && <>
        <div className="grid-2 grid-wide-left">
          <Now weather={weather} />
          <div className="advisories">
            <Advisory title="Rain, next 6 hours" band={rainBand(Math.max(...weather.hourly.slice(0, 6).map((h) => h.precipitation)))}
              value={`${Math.max(...weather.hourly.slice(0, 6).map((h) => h.precipitation)).toFixed(1)} mm/h`}
              hint="Heaviest hour, graded on PAGASA’s rainfall warning scale" />
            <Advisory title="Heat index" band={heatBand(weather.current.feelsLike)} value={`${Math.round(weather.current.feelsLike)}°C`}
              hint="Open-Meteo’s feels-like temperature, graded on PAGASA’s heat index scale" />
            <Link to="/map?tab=active&type=FLOODING" className="kpi">
              <span className="kpi-label">Active flooding reports</span>
              <span className="kpi-value">{flooding ?? '—'}</span>
              <span className="muted advisory-note">See them on the map ›</span>
            </Link>
          </div>
        </div>

        <section className="card">
          <div className="card-head">
            <h2>Rain, next 24 hours</h2>
            <span className="muted">mm per hour</span>
          </div>
          <RainChart hourly={weather.hourly} />
          {weather.hourly.every((h) => h.precipitation === 0) && <p className="muted chart-empty">No rain expected in the next 24 hours.</p>}
          <ol className="hour-strip" aria-label="Hourly forecast">
            {weather.hourly.map((h) => (
              <li key={h.time}>
                <span className="muted">{hourLabel(h.time)}</span>
                <span className="weather-icon" title={conditionLabel(h.code)}
                  dangerouslySetInnerHTML={{ __html: conditionIcon(h.code, isDaytime(h.time), 22) }} />
                <strong>{Math.round(h.temperature)}°</strong>
                <span className="muted">{h.chance}%</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>7-day forecast</h2>
            <span className="muted">High / low · rain · chance of rain</span>
          </div>
          <ul className="day-list">
            {weather.daily.map((d, i) => (
              <li key={d.date} className="day-row">
                <span className="day-name">{dayName(d.date, i)}</span>
                <span className="weather-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: conditionIcon(d.code, true, 22) }} />
                <span className="day-condition">{conditionLabel(d.code)}</span>
                <span className="day-temps"><strong>{Math.round(d.max)}°</strong> <span className="muted">{Math.round(d.min)}°</span></span>
                <span className="day-rain">{d.precipitation.toFixed(1)} mm</span>
                <span className="muted day-chance">{d.chance}%</span>
              </li>
            ))}
          </ul>
        </section>
      </>}

      <RainfallCard />
    </div>
  );
}

type RainMapMode = 'live' | RainWindow;

const MODES: { value: RainMapMode; label: string; span?: string }[] = [
  { value: 'live', label: 'Live' },
  { value: 'day', label: '24 hours', span: 'the last 24 hours' },
  { value: 'threeDays', label: '3 days', span: 'the last 3 days' },
  { value: 'week', label: '1 week', span: 'the last week' },
];

/** RainViewer's "Universal Blue" rain colours (their published colour table), light to heavy. */
const RADAR_LEGEND = [
  { color: '#cec087', label: 'Drizzle' }, { color: '#00a3e0', label: 'Light' }, { color: '#005588', label: 'Moderate' },
  { color: '#ffee00', label: 'Heavy' }, { color: '#ffaa00', label: 'Intense' }, { color: '#c10000', label: 'Torrential' },
];

/** Rain across Makati's barangays: live radar, or totals for the last day, 3 days or week. */
function RainfallCard() {
  const barangays = useBarangays();
  const history = useRainHistory(barangays);
  const radar = useRadar();
  const [mode, setMode] = useState<RainMapMode>('live');
  const live = mode === 'live';
  const areas = history.data?.areas ?? null;
  const values = (areas ?? []).map((a) => (live ? a.now : a[mode]));
  const max = values.length ? Math.max(...values) : 0;
  const min = values.length ? Math.min(...values) : 0;
  const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const span = MODES.find((m) => m.value === mode)?.span;
  // Past windows shade the barangays; live mode draws outlines over the radar.
  const shaded = useMemo(() => (areas && !live ? new Map(areas.map((a) => [a.name, a[mode]])) : null), [areas, live, mode]);
  const liveByName = useMemo(() => new Map((areas ?? []).map((a) => [a.name, a.now])), [areas]);
  const overlay: MapOverlay | null = live && radar.data ? {
    url: radar.data.tileUrl, attribution: `Radar: <a href="${RADAR_SOURCE_URL}">RainViewer</a>`,
    tileSize: 512, zoomOffset: -1, maxNativeZoom: RADAR_MAX_ZOOM + 1,
  } : null;

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Rainfall across Makati</h2>
          <p className="muted rain-summary">
            {live
              ? radar.data
                ? <>Radar as of {radar.data.time.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })}
                  {radar.error && <span className="weather-stale"> · couldn’t refresh</span>}</>
                : radar.error ? <span className="weather-stale">Live radar unavailable</span> : 'Loading live radar…'
              : areas
                ? <>Makati average {avg.toFixed(1)} mm over {span} · {min.toFixed(1)}–{max.toFixed(1)} mm across barangays
                  {history.error && <span className="weather-stale"> · couldn’t refresh</span>}</>
                : null}
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Rainfall period">
          {MODES.map((m) => (
            <button key={m.value} type="button" aria-pressed={mode === m.value} onClick={() => setMode(m.value)}>{m.label}</button>
          ))}
        </div>
      </div>

      {!areas && history.error && !live
        ? <ErrorState title="We couldn’t load past rainfall." message={history.error} onRetry={history.reload} />
        : (
          <div className="grid-2 grid-wide-left">
            <div>
              <AreaMap barangays={barangays} values={shaded} max={max} overlay={overlay} framing={live ? 'wide' : 'fit'}
                format={(v, name) => {
                  if (live) {
                    const now = liveByName.get(name);
                    return now == null ? 'No data' : `${now.toFixed(1)} mm in the last 15 min (model)`;
                  }
                  return v == null ? 'No data' : `${v.toFixed(1)} mm`;
                }}
                label={live ? 'Live rain radar over Metro Manila with Makati barangay outlines'
                  : 'Makati barangays shaded by rainfall; the ranked list beside the map has the same numbers'} />
              {live
                ? <div className="rain-legend" aria-label="Radar rain intensity">
                    {RADAR_LEGEND.map((l) => <span key={l.label}><i style={{ background: l.color }} />{l.label}</span>)}
                    <span className="muted">Radar: <a href={RADAR_SOURCE_URL} target="_blank" rel="noreferrer">RainViewer</a></span>
                  </div>
                : <div className="rain-legend" aria-label="Rainfall scale">
                    <span className="muted">0 mm</span>
                    <span className="rain-ramp" style={{ background: `linear-gradient(90deg, ${SEQUENTIAL_BLUE.join(', ')})` }} />
                    <span className="muted">{max.toFixed(1)} mm</span>
                  </div>}
              <p className="muted rain-note">
                {live
                  ? 'Radar is shown at about 600 m detail, the finest the free feed offers. It updates every 10 minutes.'
                  : 'Weather models work on a grid a few kilometres wide, so neighbouring barangays often share a value.'}
              </p>
            </div>
            <div>
              <h3 className="rain-list-title">
                {live ? 'Rain in the last 15 minutes' : `Rain over ${span}`}
                <span className="muted">{live ? ' · model estimate' : ' · by barangay'}</span>
              </h3>
              {areas
                ? <BarList
                    rows={[...(areas)].map((a) => ({ key: a.name, label: a.name, value: live ? a.now : a[mode] }))
                      .sort((a, b) => b.value - a.value)}
                    format={(n) => `${n.toFixed(1)} mm`}
                    empty={live ? 'No rain right now in any barangay' : 'No rain recorded in this period'} />
                : <div className="skeleton" style={{ height: 320 }} />}
            </div>
          </div>
        )}
    </section>
  );
}

function Now({ weather }: { weather: Weather }) {
  const c = weather.current;
  return (
    <section className="card weather-now">
      <span className="weather-now-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: conditionIcon(c.code, c.isDay, 64) }} />
      <div>
        <div className="weather-now-temp">{Math.round(c.temperature)}°C</div>
        <div className="weather-now-label">{conditionLabel(c.code)}</div>
        <p className="muted">Feels like {Math.round(c.feelsLike)}°C</p>
      </div>
      <dl className="weather-facts">
        <div><dt>Humidity</dt><dd>{c.humidity}%</dd></div>
        <div><dt>Wind</dt><dd>{Math.round(c.windSpeed)} km/h</dd></div>
        <div><dt>Gusts</dt><dd>{Math.round(c.windGusts)} km/h</dd></div>
        <div><dt>Rain, last 15 min</dt><dd>{c.precipitation.toFixed(1)} mm</dd></div>
      </dl>
    </section>
  );
}

/** Status tone always comes with its label, so the colour bar is never the only signal. */
function Advisory({ title, band, value, hint }: { title: string; band: Band; value: string; hint: string }) {
  const tone = band.tone === 'critical' ? ' kpi-critical' : band.tone === 'warning' ? ' kpi-warning' : ' kpi-good';
  return (
    <div className={`kpi${tone}`} title={hint}>
      <span className="kpi-label">{title}</span>
      <span className="kpi-value">{value}</span>
      <span className="advisory-band">{band.label}</span>
      <span className="muted advisory-note">{band.note}</span>
    </div>
  );
}

function WeatherSkeleton() {
  return (
    <>
      <div className="grid-2 grid-wide-left">
        <div className="skeleton" style={{ height: 220 }} />
        <div className="skeleton" style={{ height: 220 }} />
      </div>
      <div className="skeleton" style={{ height: 300 }} />
    </>
  );
}
