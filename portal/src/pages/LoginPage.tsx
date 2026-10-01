import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import { ApiError, login } from '../api/client';
import { loadBarangays, type Barangay } from '../lib/geo';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in didn’t work. Try again.');
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <section className="login-brand" aria-hidden="true">
        <div className="login-brand-top">
          <img src="/logo-mark.png" alt="" width={34} height={40} />
          <span>SafeRoute</span>
        </div>
        <MakatiOutline />
        <div className="login-brand-copy">
          <p className="login-tagline">Safer streets.<br />Better decisions.</p>
          <p className="login-sub">Live pedestrian hazard reports from Makati’s commuters, verified by the community and handled by the city.</p>
        </div>
      </section>

      <section className="login-panel">
        <form className="login-form" onSubmit={submit}>
          <div className="login-mobile-brand">
            <img src="/logo-mark.png" alt="" width={30} height={35} />
            <span>SafeRoute</span>
          </div>
          <div>
            <h1>Welcome back</h1>
            <p className="muted">Sign in to the Makati municipal hazard portal.</p>
          </div>
          <label className="field">
            <span>Official email</span>
            <span className="input-icon">
              <Mail aria-hidden="true" size={17} />
              <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
                placeholder="name@makati.gov.ph" />
            </span>
          </label>
          <label className="field">
            <span>Password</span>
            <span className="input-icon">
              <Lock aria-hidden="true" size={17} />
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </span>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? 'Signing in…' : <>Sign in<ArrowRight size={17} aria-hidden="true" /></>}
          </button>
          <p className="muted small login-foot">For municipal officials and moderators. Commuters report hazards in the SafeRoute iPhone app.</p>
        </form>
      </section>
    </main>
  );
}

/** Makati's barangays as thin outlines: a recognisable city shape, with no labels to read. */
function MakatiOutline() {
  const [list, setList] = useState<Barangay[]>([]);
  useEffect(() => {
    let alive = true;
    loadBarangays().then((b) => { if (alive) setList(b); });
    return () => { alive = false; };
  }, []);
  if (!list.length) return <div className="login-map" />;

  let minLat = 90, minLon = 180, maxLat = -90, maxLon = -180;
  for (const b of list) {
    minLat = Math.min(minLat, b.bbox[0]); minLon = Math.min(minLon, b.bbox[1]);
    maxLat = Math.max(maxLat, b.bbox[2]); maxLon = Math.max(maxLon, b.bbox[3]);
  }
  // Equirectangular, with longitude shrunk by cos(latitude) so the shape isn't stretched.
  const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const W = 600;
  const scale = W / ((maxLon - minLon) * k);
  const H = (maxLat - minLat) * scale;
  const pt = ([lon, lat]: number[]) => `${((lon - minLon) * k * scale).toFixed(1)},${((maxLat - lat) * scale).toFixed(1)}`;
  const paths = list.map((b) => b.polygons.map((poly) => poly.map((ring) => `M${ring.map(pt).join('L')}Z`).join('')).join(''));
  // A few hazards as glowing dots, placed at barangay centres for texture.
  const dots = list.filter((_, i) => i % 5 === 2).map((b) => [(b.bbox[1] + b.bbox[3]) / 2, (b.bbox[0] + b.bbox[2]) / 2]);

  return (
    <svg className="login-map" viewBox={`-20 -20 ${W + 40} ${H + 40}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="dot-glow">
          <stop offset="0" stopColor="#93C5FD" stopOpacity="0.9" />
          <stop offset="1" stopColor="#93C5FD" stopOpacity="0" />
        </radialGradient>
      </defs>
      {paths.map((d, i) => <path key={i} d={d} className="login-map-area" />)}
      {dots.map(([lon, lat], i) => {
        const [x, y] = pt([lon, lat]).split(',').map(Number);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="18" fill="url(#dot-glow)" />
            <circle cx={x} cy={y} r="3.5" className="login-map-dot" />
          </g>
        );
      })}
    </svg>
  );
}
