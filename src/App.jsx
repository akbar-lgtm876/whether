import { useState, useEffect, useRef, useMemo } from "react";
import "./App.css";

/* Isobar — погода на Open-Meteo (ключ не нужен) */
const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const FC = "https://api.open-meteo.com/v1/forecast";
const AQ = "https://air-quality-api.open-meteo.com/v1/air-quality";

const WX = (c) =>
  c === 0 ? ["Ясно", "clear"] : c <= 2 ? ["Малооблачно", "part"] : c === 3 ? ["Пасмурно", "cloud"] :
  c <= 48 ? ["Туман", "fog"] : c <= 57 ? ["Морось", "rain"] : c <= 67 ? ["Дождь", "rain"] :
  c <= 77 ? ["Снег", "snow"] : c <= 82 ? ["Ливень", "rain"] : c <= 86 ? ["Снегопад", "snow"] : ["Гроза", "storm"];

const CLOUD = "M7 16a4 4 0 010-8 5.5 5.5 0 0110.6 1.5A3.3 3.3 0 0117 16z";
const ICONS = {
  clear: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2 2M16.7 16.7l2 2M5.3 18.7l2-2M16.7 7.3l2-2" /></>,
  moon: <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />,
  part: <><circle cx="9" cy="8" r="3" /><path d="M9 2.5V4M3.5 8H5M5 4l1 1M13 4l-1 1" /><path d="M9 21a3.5 3.5 0 010-7 5 5 0 019.6 1.3A3 3 0 0118 21z" /></>,
  cloud: <path d={CLOUD.replace("16", "18").replace("16z", "18z")} />,
  rain: <><path d={CLOUD} /><path d="M8 19l-1 2.5M12 19l-1 2.5M16 19l-1 2.5" /></>,
  snow: <><path d={CLOUD} /><path d="M8 19h.01M12 20h.01M16 19h.01M10 22h.01M14 22h.01" strokeWidth="2.4" /></>,
  fog: <path d="M8 5h8M4 9h16M3 13h18M6 17h12M9 21h6" />,
  storm: <><path d={CLOUD} /><path d="M12.5 15l-2.5 4h3.5l-2 3.5" /></>,
};
const Icon = ({ k, night, s = 26 }) => (
  <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    {ICONS[night && k === "clear" ? "moon" : k]}
  </svg>
);

const SKY = {
  night: ["#060A14", "#0E1830", "#1C2A4A"], dawn: ["#161C40", "#6A4878", "#F3A468"],
  day: ["#1B4A86", "#4C86C4", "#C4DCF0"], dusk: ["#121838", "#7B3F6C", "#F28F5F"],
};
const DIRS = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"];
const hhmm = (s) => s.slice(11, 16);
const mod = (a, n) => ((a % n) + n) % n;
const aqiCol = (v) => (v <= 50 ? "#5FD38D" : v <= 100 ? "#E8D24A" : v <= 150 ? "#F5A04A" : v <= 200 ? "#EF5B5B" : "#A25CD6");
const aqiTxt = (v) => (v == null ? "нет данных" : v <= 50 ? "Хороший" : v <= 100 ? "Умеренный" : v <= 150 ? "Вреден для чувствительных" : v <= 200 ? "Вредный" : "Опасный");
const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };

function moonInfo(date) {
  const p = mod((date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000, 29.530588) / 29.530588;
  const names = p < 0.03 || p > 0.97 ? "Новолуние" : p < 0.22 ? "Растущий серп" : p < 0.28 ? "Первая четверть" : p < 0.47 ? "Растущая луна" : p < 0.53 ? "Полнолуние" : p < 0.72 ? "Убывающая луна" : p < 0.78 ? "Последняя четверть" : "Убывающий серп";
  return { p, name: names, lit: Math.round((1 - Math.cos(2 * Math.PI * p)) * 50) };
}
function Moon({ p }) {
  const f = p < 0.5 ? p : 1 - p, rx = 11 * Math.abs(Math.cos(2 * Math.PI * f));
  return (
    <svg viewBox="-12 -12 24 24" width="44" height="44" style={p >= 0.5 ? { transform: "scaleX(-1)" } : null}>
      <circle r="11" fill="rgba(255,255,255,.12)" />
      <path d={`M0 -11A11 11 0 010 11A${rx} 11 0 0${f < 0.25 ? 0 : 1} 0 -11`} fill="#E9EEF7" />
    </svg>
  );
}

/* ---- Фон: поток частиц по реальному ветру + осадки ---- */
function Flow({ speed, dir, kind }) {
  const ref = useRef(null);
  const st = useRef({});
  st.current = { speed, dir, kind };
  useEffect(() => {
    const cv = ref.current, ctx = cv.getContext("2d");
    let raf, t = 0, W = 0, H = 0;
    const resize = () => {
      const r = devicePixelRatio || 1; W = innerWidth; H = innerHeight;
      cv.width = W * r; cv.height = H * r; ctx.setTransform(r, 0, 0, r, 0, 0);
    };
    resize(); addEventListener("resize", resize);
    const mk = () => ({ x: Math.random() * W, y: Math.random() * H, z: 0.3 + Math.random() * 0.7, l: 80 + Math.random() * 220 });
    const fl = Array.from({ length: 650 }, mk), pr = Array.from({ length: 240 }, mk);
    const loop = () => {
      const { speed: s, dir: d, kind: k } = st.current; t += 0.004;
      ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = "rgba(0,0,0,.07)"; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      const a = ((d + 90) * Math.PI) / 180, v = 0.4 + (Math.min(s, 60) / 60) * 3.4;
      for (const p of fl) {
        const ang = a + Math.sin(p.x * 0.003 + t * 3) * 0.6 + Math.cos(p.y * 0.004 - t * 2) * 0.6;
        const nx = p.x + Math.cos(ang) * v * p.z, ny = p.y + Math.sin(ang) * v * p.z;
        ctx.strokeStyle = `rgba(255,255,255,${0.1 + 0.25 * p.z})`;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); ctx.stroke();
        p.x = nx; p.y = ny;
        if (--p.l < 0 || nx < -20 || nx > W + 20 || ny < -20 || ny > H + 20) Object.assign(p, mk());
      }
      if (k === "rain" || k === "storm" || k === "snow") {
        const lat = Math.cos(((d + 90) * Math.PI) / 180) * Math.min(s, 40) * 0.12;
        for (const p of pr) {
          if (k === "snow") {
            p.y += 0.6 + p.z * 1.3; p.x += Math.sin(t * 40 + p.l) * 0.4 + lat * 0.3;
            ctx.fillStyle = `rgba(255,255,255,${0.35 + p.z * 0.5})`;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.z * 2.2, 0, 7); ctx.fill();
          } else {
            p.y += 12 + p.z * 16; p.x += lat * p.z;
            ctx.strokeStyle = `rgba(190,220,255,${0.2 + p.z * 0.4})`;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - lat * 1.6, p.y - 10 - p.z * 14); ctx.stroke();
          }
          if (p.y > H + 20) { p.y = -20; p.x = Math.random() * W; }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} className="flow" aria-hidden />;
}

function fieldColor(layer, F, la, lo) {
  const fy = Math.min(9.999, Math.max(0, (la + 75) / 15)), fx = mod(lo + 180, 360) / 15;
  const y0 = Math.floor(fy), x0 = Math.floor(fx), ty = fy - y0, tx = fx - x0, x1 = (x0 + 1) % 24, a = F[layer];
  const g = (y, x) => a[y * 24 + x] ?? 0;
  const v = (g(y0, x0) * (1 - tx) + g(y0, x1) * tx) * (1 - ty) + (g(y0 + 1, x0) * (1 - tx) + g(y0 + 1, x1) * tx) * ty;
  if (layer === "temp") return `hsla(${Math.round(250 - Math.min(1, Math.max(0, (v + 30) / 70)) * 250)},85%,58%,A)`;
  if (layer === "cloud") return `hsla(215,25%,${35 + v * 0.6}%,A)`;
  return `hsla(200,95%,${v < 0.1 ? 22 : 40 + Math.min(v, 4) * 10}%,A)`;
}

function CmpChart({ rows, times }) {
  const [h, setH] = useState(null);
  const Wd = 760, Ht = 220, L = 8, Rt = 8, Tp = 14, B = 26, n = times.length;
  const all = rows.flatMap((r) => r.vals), mn = Math.min(...all), mx = Math.max(...all), pad = (mx - mn || 1) * 0.12;
  const x = (i) => L + ((Wd - L - Rt) * i) / (n - 1), y = (v) => Tp + (Ht - Tp - B) * (1 - (v - (mn - pad)) / (mx - mn + 2 * pad || 1));
  const move = (e) => { const r = e.currentTarget.getBoundingClientRect(); setH(Math.max(0, Math.min(n - 1, Math.round(((((e.clientX - r.left) / r.width) * Wd - L) / (Wd - L - Rt)) * (n - 1))))); };
  return (
    <>
      <svg viewBox={`0 0 ${Wd} ${Ht}`} className="chart" onPointerMove={move} onPointerLeave={() => setH(null)}>
        {[0, 0.5, 1].map((q) => <line key={q} x1={L} x2={Wd - Rt} y1={Tp + (Ht - Tp - B) * q} y2={Tp + (Ht - Tp - B) * q} className="grid" />)}
        {rows.map((r) => <path key={r.name + r.color} className="cl" stroke={r.color} d={r.vals.map((v, i) => `${i ? "L" : "M"}${x(i)} ${y(v)}`).join("")} />)}
        {times.map((t, i) => i % 6 === 0 && <text key={i} x={x(i)} y={Ht - 8} className="ax" textAnchor="middle">{i === 24 ? "завтра" : t}</text>)}
        {h != null && <line x1={x(h)} x2={x(h)} y1={Tp} y2={Ht - B} className="cur" />}
      </svg>
      <div className="lg2">{rows.map((r) => <span key={r.name + r.color}><i style={{ background: r.color }} />{r.name}<b>{h != null ? `${r.vals[h]}°` : ""}</b></span>)}</div>
    </>
  );
}

/* ---- Рабочий 3D-глобус: карта мира, день/ночь, клик по точке или городу ---- */
const LAND = "https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json";
const CITIES = [["Ташкент", 41.2995, 69.2401, "Узбекистан"], ["Москва", 55.7558, 37.6173, "Россия"], ["Лондон", 51.5072, -0.1276, "Великобритания"], ["Париж", 48.8566, 2.3522, "Франция"], ["Берлин", 52.52, 13.405, "Германия"], ["Стамбул", 41.0082, 28.9784, "Турция"], ["Дубай", 25.2048, 55.2708, "ОАЭ"], ["Дели", 28.6139, 77.209, "Индия"], ["Алматы", 43.222, 76.8512, "Казахстан"], ["Пекин", 39.9042, 116.4074, "Китай"], ["Токио", 35.6762, 139.6503, "Япония"], ["Сеул", 37.5665, 126.978, "Южная Корея"], ["Сингапур", 1.3521, 103.8198, "Сингапур"], ["Сидней", -33.8688, 151.2093, "Австралия"], ["Каир", 30.0444, 31.2357, "Египет"], ["Лагос", 6.5244, 3.3792, "Нигерия"], ["Кейптаун", -33.9249, 18.4241, "ЮАР"], ["Нью-Йорк", 40.7128, -74.006, "США"], ["Лос-Анджелес", 34.0522, -118.2437, "США"], ["Мехико", 19.4326, -99.1332, "Мексика"], ["Сан-Паулу", -23.5505, -46.6333, "Бразилия"], ["Буэнос-Айрес", -34.6037, -58.3816, "Аргентина"], ["Торонто", 43.6532, -79.3832, "Канада"], ["Рейкьявик", 64.1466, -21.9426, "Исландия"]];
const GS = 420, GC = 210, RAD = Math.PI / 180;

function gproj(la, lo, L0, F0, R) {
  const p = la * RAD, dl = (lo - L0) * RAD, p0 = F0 * RAD;
  return [GC + R * Math.cos(p) * Math.sin(dl), GC - R * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(dl)),
    Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(dl)];
}
function ginv(x, y, L0, F0, R) {
  const X = (x - GC) / R, Y = (GC - y) / R, rho = Math.hypot(X, Y);
  if (rho > 1) return null;
  if (rho === 0) return [F0, L0];
  const c = Math.asin(rho), p0 = F0 * RAD;
  const la = Math.asin(Math.cos(c) * Math.sin(p0) + (Y * Math.sin(c) * Math.cos(p0)) / rho);
  const lo = L0 + (Math.atan2(X * Math.sin(c), rho * Math.cos(p0) * Math.cos(c) - Y * Math.sin(p0) * Math.sin(c)) / RAD);
  return [la / RAD, mod(lo + 180, 360) - 180];
}
function decodeLand(topo) {
  const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;
  const arcs = topo.arcs.map((a) => { let x = 0, y = 0; return a.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; }); });
  const ring = (idx) => idx.flatMap((i) => (i >= 0 ? arcs[i] : [...arcs[~i]].reverse()));
  const geoms = topo.objects.land.geometries ?? [topo.objects.land], polys = [];
  for (const g of geoms) for (const p of g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : []) {
    const rings = p.map(ring), xs = rings[0].map((q) => q[0]), ys = rings[0].map((q) => q[1]);
    polys.push({ rings, b: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] });
  }
  return polys;
}
function inPoly(lo, la, P) {
  if (lo < P.b[0] || lo > P.b[1] || la < P.b[2] || la > P.b[3]) return false;
  let c = false;
  for (const r of P.rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > la) !== (r[j][1] > la) && lo < ((r[j][0] - r[i][0]) * (la - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
}

function Globe({ lat, lon, onPick, layer, field }) {
  const ref = useRef(null);
  const Lr = useRef({}); Lr.current = { layer, field };
  const tgt = useRef({ lat, lon });
  const g = useRef({ off: 0, lo: 0, z: 1, d: null, hover: null, grid: [], rings: [], l0: 0, f0: 0, R: 170 });
  const cb = useRef(onPick); cb.current = onPick;
  useEffect(() => { tgt.current = { lat, lon }; g.current.off = 0; g.current.lo = 0; }, [lat, lon]);

  useEffect(() => {
    const cv = ref.current, ctx = cv.getContext("2d"), s = g.current, r = Math.min(devicePixelRatio || 1, 2);
    cv.width = cv.height = GS * r; ctx.setTransform(r, 0, 0, r, 0, 0);
    for (let la = -84; la <= 84; la += 2.4) { const n = Math.max(1, Math.round(150 * Math.cos(la * RAD))); for (let i = 0; i < n; i++) s.grid.push([la, -180 + (360 * i) / n, 0]); }
    fetch(LAND).then((x) => x.json()).then((topo) => {
      const polys = decodeLand(topo);
      for (const q of s.grid) q[2] = polys.some((P) => inPoly(q[1], q[0], P)) ? 1 : 0;
      s.rings = polys.flatMap((P) => P.rings);
    }).catch(() => {});
    const wheel = (e) => { e.preventDefault(); s.z = Math.min(2.6, Math.max(0.8, s.z * (e.deltaY < 0 ? 1.1 : 0.91))); };
    cv.addEventListener("wheel", wheel, { passive: false });

    let raf, t = 0; s.l0 = tgt.current.lon - 70;
    const sunPos = () => {
      const d = new Date(), h = d.getUTCHours() + d.getUTCMinutes() / 60, doy = (d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
      return [23.44 * Math.sin((2 * Math.PI * (doy - 81)) / 365) * RAD, (12 - h) * 15 * RAD];
    };
    const [dec, sl] = sunPos(), sd = Math.sin(dec), cd = Math.cos(dec);
    const loop = () => {
      t += 0.016; const R = 170 * s.z, T = tgt.current, k = s.d ? 0.35 : 0.07;
      s.R = R;
      s.l0 += (mod(T.lon + s.off - s.l0 + 180, 360) - 180) * k;
      s.f0 += (Math.max(-80, Math.min(80, T.lat * 0.8 + s.lo)) - s.f0) * k;
      const { l0, f0 } = s;
      ctx.clearRect(0, 0, GS, GS);
      const gr = ctx.createRadialGradient(GC - 50, GC - 60, 10, GC, GC, R);
      gr.addColorStop(0, "rgba(160,200,255,.20)"); gr.addColorStop(1, "rgba(20,40,90,.10)");
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(GC, GC, R, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1; ctx.stroke();
      for (const [la, lo, ld] of s.grid) {
        const [x, y, c] = gproj(la, lo, l0, f0, R); if (c <= 0) continue;
        const p = la * RAD, sv = Math.sin(p) * sd + Math.cos(p) * cd * Math.cos(lo * RAD - sl);
        const m = 0.3 + 0.7 * Math.min(1, Math.max(0, (sv + 0.12) / 0.24));
        const fc = Lr.current.layer !== "cities" && Lr.current.field ? fieldColor(Lr.current.layer, Lr.current.field, la, lo) : null;
        ctx.fillStyle = fc ? fc.replace("A", ((ld ? 0.9 : 0.55) * (0.4 + 0.6 * c) * m).toFixed(2)) : ld ? `rgba(240,246,255,${(0.3 + 0.6 * c) * m})` : `rgba(150,195,235,${(0.05 + 0.1 * c) * m})`;
        const z = fc ? 1.5 : ld ? 1.1 : 0.6; ctx.fillRect(x - z, y - z, z * 2, z * 2);
      }
      ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.lineWidth = 0.8; ctx.beginPath();
      for (const ring of s.rings) {
        let pen = false;
        for (const [lo, la] of ring) { const [x, y, c] = gproj(la, lo, l0, f0, R); if (c > 0) { pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; } else pen = false; }
      }
      ctx.stroke();
      let over = null;
      const hv = s.hover;
      for (const c of CITIES) {
        const [x, y, cc] = gproj(c[1], c[2], l0, f0, R); if (cc <= 0) continue;
        const near = hv && Math.hypot(x - hv[0], y - hv[1]) < 14; if (near) over = c;
        ctx.fillStyle = near ? "#fff" : "rgba(255,180,84,.9)"; ctx.beginPath(); ctx.arc(x, y, near ? 4 : 2.3, 0, 7); ctx.fill();
      }
      const [x, y, c] = gproj(T.lat, T.lon, l0, f0, R);
      if (c > 0) {
        const q = (t * 0.7) % 1;
        ctx.strokeStyle = `rgba(255,180,84,${1 - q})`; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, 5 + q * 22, 0, 7); ctx.stroke();
        ctx.fillStyle = "#FFB454"; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
      }
      if (hv && !s.d) {
        const v = ginv(hv[0], hv[1], l0, f0, R);
        if (v) {
          const txt = over ? over[0] : `${Math.abs(v[0]).toFixed(1)}°${v[0] >= 0 ? "N" : "S"} ${Math.abs(v[1]).toFixed(1)}°${v[1] >= 0 ? "E" : "W"}`;
          ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(hv[0], hv[1], 7, 0, 7); ctx.stroke();
          ctx.font = "600 12px Figtree, sans-serif"; const w = ctx.measureText(txt).width + 14, bx = Math.min(hv[0] + 12, GS - w - 2);
          ctx.fillStyle = "rgba(8,12,24,.75)"; ctx.beginPath(); ctx.roundRect(bx, hv[1] - 30, w, 22, 8); ctx.fill();
          ctx.fillStyle = "#fff"; ctx.fillText(txt, bx + 7, hv[1] - 15);
        }
      }
      cv.style.cursor = s.d ? "grabbing" : over ? "pointer" : "crosshair";
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelAnimationFrame(raf); cv.removeEventListener("wheel", wheel); };
  }, []);

  const xy = (e) => { const r = ref.current.getBoundingClientRect(); return [((e.clientX - r.left) * GS) / r.width, ((e.clientY - r.top) * GS) / r.height]; };
  const hit = (x, y) => {
    const s = g.current; let best = null, bd = 14;
    for (const c of CITIES) { const [px, py, cc] = gproj(c[1], c[2], s.l0, s.f0, s.R); const d = Math.hypot(px - x, py - y); if (cc > 0 && d < bd) { bd = d; best = c; } }
    if (best) return { name: best[0], country: best[3], latitude: best[1], longitude: best[2], city: true };
    const v = ginv(x, y, s.l0, s.f0, s.R); return v && { latitude: v[0], longitude: v[1] };
  };
  const down = (e) => { g.current.d = { cx: e.clientX, cy: e.clientY, moved: 0 }; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e) => {
    const s = g.current;
    if (s.d) {
      const k = GS / ref.current.getBoundingClientRect().width / s.z, dx = e.clientX - s.d.cx, dy = e.clientY - s.d.cy;
      s.d.moved += Math.abs(dx) + Math.abs(dy); s.d.cx = e.clientX; s.d.cy = e.clientY;
      s.off -= dx * k * 0.45; s.lo = Math.max(-70, Math.min(70, s.lo + dy * k * 0.45));
    } else s.hover = xy(e);
  };
  const up = (e) => { const s = g.current; if (s.d && s.d.moved < 6) { const h = hit(...xy(e)); if (h) cb.current(h); } s.d = null; };
  const zoom = (f) => { g.current.z = Math.min(2.6, Math.max(0.8, g.current.z * f)); };
  return (
    <div className="gwrap">
      <canvas ref={ref} className="globe-cv" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => (g.current.hover = null)} />
      <div className="gz">
        <button onClick={() => zoom(1.25)} aria-label="Приблизить">+</button>
        <button onClick={() => zoom(0.8)} aria-label="Отдалить">−</button>
        <button onClick={() => { const s = g.current; s.off = 0; s.lo = 0; s.z = 1; }}>К городу</button>
      </div>
    </div>
  );
}

/* ---- График с курсором ---- */
function Chart({ vals, times, fmt, nowI, bars }) {
  const [h, setH] = useState(null);
  const Wd = 760, Ht = 230, L = 8, Rt = 8, Tp = 36, B = 28, n = vals.length;
  const mn = Math.min(...vals), mx = Math.max(...vals), pad = (mx - mn || 1) * 0.18;
  const lo = bars ? 0 : mn - pad, hi = bars ? 100 : mx + pad;
  const x = (i) => L + ((Wd - L - Rt) * i) / (n - 1), y = (v) => Tp + (Ht - Tp - B) * (1 - (v - lo) / (hi - lo || 1));
  let d = `M${x(0)} ${y(vals[0])}`;
  for (let i = 1; i < n; i++) { const m = (x(i - 1) + x(i)) / 2; d += `C${m} ${y(vals[i - 1])} ${m} ${y(vals[i])} ${x(i)} ${y(vals[i])}`; }
  const k = h ?? (nowI >= 0 && nowI < n ? nowI : null);
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setH(Math.max(0, Math.min(n - 1, Math.round(((((e.clientX - r.left) / r.width) * Wd - L) / (Wd - L - Rt)) * (n - 1)))));
  };
  return (
    <svg viewBox={`0 0 ${Wd} ${Ht}`} className="chart" onPointerMove={move} onPointerLeave={() => setH(null)}>
      <defs><linearGradient id="ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFB454" stopOpacity=".4" /><stop offset="1" stopColor="#FFB454" stopOpacity="0" /></linearGradient></defs>
      {[0, 0.5, 1].map((q) => <line key={q} x1={L} x2={Wd - Rt} y1={Tp + (Ht - Tp - B) * q} y2={Tp + (Ht - Tp - B) * q} className="grid" />)}
      {bars
        ? vals.map((v, i) => <rect key={i} x={x(i) - 7} width="14" y={y(v)} height={Ht - B - y(v)} rx="2" fill="#8ADBEA" opacity={k === i ? 1 : 0.55} />)
        : <><path d={`${d}L${x(n - 1)} ${Ht - B}L${x(0)} ${Ht - B}Z`} fill="url(#ar)" /><path d={d} className="line" /></>}
      {vals.map((_, i) => i % 3 === 0 && <text key={i} x={x(i)} y={Ht - 8} className="ax" textAnchor="middle">{times[i]}</text>)}
      {k != null && <>
        <line x1={x(k)} x2={x(k)} y1={Tp - 6} y2={Ht - B} className="cur" />
        {!bars && <circle cx={x(k)} cy={y(vals[k])} r="5" fill="#FFB454" stroke="#0b1020" strokeWidth="2" />}
        <text x={Math.max(80, Math.min(Wd - 80, x(k)))} y="20" textAnchor="middle" className="tip">{times[k]} · {fmt(vals[k])}</text>
      </>}
    </svg>
  );
}

function Logo() {
  return (
    <a className="logo" href="./" aria-label="Isobar">
      <svg viewBox="0 0 40 40" width="38" height="38" fill="none" strokeLinecap="round">
        <path className="arc a1" d="M6 28C6 14 16 6 30 8" /><path className="arc a2" d="M6 28C10 18 16 13 25 14" />
        <path className="arc a3" d="M6 28C10 24 14 21 19 21" /><circle className="sun" cx="31" cy="29" r="3.2" />
      </svg>
      <b>isobar</b>
    </a>
  );
}

export default function App() {
  const [q, setQ] = useState(""); const [focus, setFocus] = useState(false); const [sugg, setSugg] = useState([]);
  const [place, setPlace] = useState(null); const [w, setW] = useState(null); const [air, setAir] = useState(null);
  const [loading, setLoading] = useState(false); const [err, setErr] = useState(""); const [toast, setToast] = useState("");
  const [prefs, setPrefs] = useState(() => ({ t: "C", w: "ms", p: "mm", th: "dusk", ...ls("isobar-prefs", {}) }));
  const [favs, setFavs] = useState(() => ls("isobar-favs", [])); const [recents, setRecents] = useState(() => ls("isobar-recents", []));
  const [day, setDay] = useState(1); const [metric, setMetric] = useState("temp"); const [view, setView] = useState("now");
  const [menu, setMenu] = useState(false); const [updated, setUpdated] = useState(null);
  const [field, setField] = useState(null); const [layer, setLayer] = useState("cities");
  const [clim, setClim] = useState(null); const [cmp, setCmp] = useState(null);
  const inp = useRef(null);
  const loadClim = async (p, date) => {
    setClim(null);
    try {
      const y = +date.slice(0, 4);
      const j = await (await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${p.latitude}&longitude=${p.longitude}&start_date=${y - 10}-01-01&end_date=${y - 1}-12-31&daily=temperature_2m_max,temperature_2m_min&timezone=auto`)).json();
      const doy = (s) => (Date.parse(s) - Date.parse(s.slice(0, 4) + "-01-01")) / 864e5, t0 = doy(date), hi = [], lo = [];
      j.daily.time.forEach((s, i) => { if (Math.abs(doy(s) - t0) <= 3 && j.daily.temperature_2m_max[i] != null) { hi.push(j.daily.temperature_2m_max[i]); lo.push(j.daily.temperature_2m_min[i]); } });
      const avg = (a) => a.reduce((x, z) => x + z, 0) / a.length;
      setClim({ hi: avg(hi), lo: avg(lo), rh: Math.max(...hi), rl: Math.min(...lo) });
    } catch { setClim(false); }
  };

  const T = (c) => (prefs.t === "C" ? Math.round(c) : Math.round((c * 9) / 5 + 32));
  const Wn = (k) => (prefs.w === "ms" ? Math.round((k / 3.6) * 10) / 10 : prefs.w === "kmh" ? Math.round(k) : Math.round(k / 1.609));
  const Wu = { ms: "м/с", kmh: "км/ч", mph: "mph" }[prefs.w];
  const Pr = (h) => (prefs.p === "mm" ? `${Math.round(h * 0.75006)} мм рт. ст.` : `${Math.round(h)} гПа`);
  const same = (a, b) => a.latitude === b.latitude && a.longitude === b.longitude;

  useEffect(() => { try { localStorage.setItem("isobar-prefs", JSON.stringify(prefs)); } catch {} }, [prefs]);
  useEffect(() => { try { localStorage.setItem("isobar-favs", JSON.stringify(favs)); } catch {} }, [favs]);
  useEffect(() => { try { localStorage.setItem("isobar-recents", JSON.stringify(recents)); } catch {} }, [recents]);
  useEffect(() => { if (toast) { const id = setTimeout(() => setToast(""), 2200); return () => clearTimeout(id); } }, [toast]);

  useEffect(() => {
    if (q.trim().length < 2) return setSugg([]);
    const id = setTimeout(async () => {
      try { const j = await (await fetch(`${GEO}?name=${encodeURIComponent(q)}&count=6&language=ru`)).json(); setSugg(j.results || []); } catch { setSugg([]); }
    }, 280);
    return () => clearTimeout(id);
  }, [q]);

  const load = async (p, silent) => {
    if (!silent) { setLoading(true); setErr(""); setDay(1); }
    setPlace(p); setQ(""); inp.current?.blur();
    try {
      const f = await (await fetch(`${FC}?latitude=${p.latitude}&longitude=${p.longitude}&timezone=auto&forecast_days=7&past_days=1` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,cloud_cover,precipitation` +
        `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation_probability,wind_speed_10m,weather_code` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max`)).json();
      if (f.error) throw new Error(f.reason);
      setW(f); setUpdated(new Date());
      try { localStorage.setItem("isobar-last", JSON.stringify(p)); } catch {}
      if (!silent) loadClim(p, f.daily.time[1]);
      fetch(`${AQ}?latitude=${p.latitude}&longitude=${p.longitude}&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide`).then((r) => r.json()).then(setAir).catch(() => setAir(null));
      history.replaceState(null, "", `#${p.latitude.toFixed(3)},${p.longitude.toFixed(3)},${encodeURIComponent(p.name)},${encodeURIComponent(p.country || "")}`);
      if (!silent) setRecents((r) => [p, ...r.filter((x) => !same(x, p))].slice(0, 5));
    } catch { setErr("Не удалось получить данные. Проверьте соединение и попробуйте ещё раз."); }
    setLoading(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (sugg[0]) return load(sugg[0]);
    if (!q.trim()) return;
    const j = await (await fetch(`${GEO}?name=${encodeURIComponent(q)}&count=1&language=ru`)).json().catch(() => ({}));
    j.results ? load(j.results[0]) : setErr(`Город «${q}» не найден. Проверьте написание.`);
  };
  const locate = () => navigator.geolocation?.getCurrentPosition(
    (s) => load({ name: "Моё место", country: "", latitude: s.coords.latitude, longitude: s.coords.longitude }),
    () => setErr("Нет доступа к геолокации. Разрешите её в настройках браузера."));

  useEffect(() => {
    const m = location.hash.slice(1).split(",");
    load(m.length >= 3 && !isNaN(m[0]) ? { latitude: +m[0], longitude: +m[1], name: decodeURIComponent(m[2]), country: decodeURIComponent(m[3] || "") }
      : ls("isobar-last", { name: "Ташкент", country: "Узбекистан", latitude: 41.2995, longitude: 69.2401 }));
    const key = (e) => { if (e.key === "/" && document.activeElement.tagName !== "INPUT") { e.preventDefault(); inp.current?.focus(); } if (e.key === "Escape") inp.current?.blur(); };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  }, []);
  useEffect(() => { if (!place) return; const id = setInterval(() => load(place, true), 600000); return () => clearInterval(id); }, [place]);

  const pickGlobe = async (p) => {
    if (p.city) return load(p);
    const lt = p.latitude, ln = p.longitude;
    const base = { name: `${Math.abs(lt).toFixed(1)}° ${lt >= 0 ? "с. ш." : "ю. ш."}, ${Math.abs(ln).toFixed(1)}° ${ln >= 0 ? "в. д." : "з. д."}`, country: "", latitude: lt, longitude: ln };
    load(base);
    try {
      const j = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lt}&longitude=${ln}&localityLanguage=ru`)).json();
      const name = j.city || j.locality || j.principalSubdivision;
      if (name) {
        const np = { ...base, name, country: j.countryName || "" };
        setPlace((c) => (c && c.latitude === lt ? np : c));
        history.replaceState(null, "", `#${lt.toFixed(3)},${ln.toFixed(3)},${encodeURIComponent(name)},${encodeURIComponent(np.country)}`);
      }
    } catch {}
  };
  const cur = w?.current, D = w?.daily, H = w?.hourly;
  const nowI = useMemo(() => (w ? H.time.findIndex((t) => t.slice(0, 13) === cur.time.slice(0, 13)) : -1), [w]);
  const [desc, kind] = cur ? WX(cur.weather_code) : ["", "clear"];
  const night = cur && !cur.is_day;

  const sky = useMemo(() => {
    if (!w) return SKY.night;
    const now = Date.parse(cur.time), sr = Date.parse(D.sunrise[1]), ss = Date.parse(D.sunset[1]);
    const m = (now - sr) / 60000, e = (ss - now) / 60000;
    return m > -60 && m < 45 ? SKY.dawn : e > -50 && e < 45 ? SKY.dusk : m >= 45 && e >= 45 ? SKY.day : SKY.night;
  }, [w]);
  const cover = cur ? cur.cloud_cover / 100 : 0;
  const skyFilter = `saturate(${1 - cover * 0.65}) brightness(${1 - (kind === "storm" ? 0.45 : kind === "rain" ? 0.3 : cover * 0.15)})`;

  const metrics = {
    temp: { l: "Температура", k: "temperature_2m", f: T, fmt: (v) => `${v}°` },
    feels: { l: "Ощущается", k: "apparent_temperature", f: T, fmt: (v) => `${v}°` },
    rain: { l: "Осадки", k: "precipitation_probability", f: (v) => v, fmt: (v) => `${v}%`, bars: 1 },
    wind: { l: "Ветер", k: "wind_speed_10m", f: Wn, fmt: (v) => `${v} ${Wu}` },
    hum: { l: "Влажность", k: "relative_humidity_2m", f: (v) => v, fmt: (v) => `${v}%` },
  };
  const M = metrics[metric];
  const seg = w ? H[M.k].slice(day * 24, day * 24 + 24).map(M.f) : [];
  const times = w ? H.time.slice(day * 24, day * 24 + 24).map(hhmm) : [];

  const delta = w && nowI >= 24 ? T(cur.temperature_2m) - T(H.temperature_2m[nowI - 24]) : null;
  const nextH = w ? Array.from({ length: 24 }, (_, i) => nowI + i) : [];
  const summary = () => {
    if (!w) return "";
    const rainI = nextH.find((i) => H.precipitation_probability[i] >= 50 && WX(H.weather_code[i])[1] !== "clear");
    const parts = [`${desc}. Днём до ${T(D.temperature_2m_max[1])}°, ночью около ${T(D.temperature_2m_min[1])}°.`];
    parts.push(rainI != null ? `Осадки вероятны около ${hhmm(H.time[rainI])}.` : "Заметных осадков не ожидается.");
    if (cur.wind_gusts_10m > 40) parts.push(`Порывы ветра до ${Wn(cur.wind_gusts_10m)} ${Wu}.`);
    return parts.join(" ");
  };
  const advice = () => {
    if (!w) return [];
    const t = cur.apparent_temperature, a = [];
    a.push(["Одежда", t < -10 ? "Тёплый пуховик, шапка, перчатки" : t < 0 ? "Зимняя куртка и шапка" : t < 10 ? "Куртка или плотное пальто" : t < 18 ? "Лёгкая куртка или свитер" : t < 26 ? "Футболка, вечером — тонкая кофта" : "Лёгкая дышащая одежда и головной убор"]);
    if (D.precipitation_probability_max[1] >= 40 || cur.precipitation > 0) a.push(["Осадки", `Возьмите зонт: вероятность до ${D.precipitation_probability_max[1]}%`]);
    if (D.uv_index_max[1] >= 3) a.push(["Солнце", `УФ ${Math.round(D.uv_index_max[1])}: крем с SPF и очки`]);
    if (cur.wind_gusts_10m > 40) a.push(["Ветер", "Сильные порывы: закрепите лёгкие вещи на балконе"]);
    if (air?.current?.us_aqi > 100) a.push(["Воздух", "Сократите время на улице, при прогулке лучше маска"]);
    return a;
  };
  const walk = w ? Math.max(0, Math.round(100 - Math.min(60, Math.abs(cur.apparent_temperature - 19) * 2.2) - D.precipitation_probability_max[1] * 0.3 - Math.max(0, cur.wind_gusts_10m - 25) * 0.8 - Math.max(0, (air?.current?.us_aqi || 0) - 50) * 0.25)) : 0;

  const sunPct = w ? (Date.parse(cur.time) - Date.parse(D.sunrise[1])) / (Date.parse(D.sunset[1]) - Date.parse(D.sunrise[1])) : 0;
  const dayLen = w ? (Date.parse(D.sunset[1]) - Date.parse(D.sunrise[1])) / 60000 : 0;
  const moon = moonInfo(new Date());
  const isFav = place && favs.some((f) => same(f, place));
  const list = q.trim().length >= 2 ? sugg : [...favs, ...recents.filter((r) => !favs.some((f) => same(f, r)))];
  const dayName = (s, i) => (i === 0 ? "Вчера" : i === 1 ? "Сегодня" : new Date(s).toLocaleDateString("ru", { weekday: "short", day: "numeric" }));
  const lo = w ? Math.min(...D.temperature_2m_min) : 0, hi = w ? Math.max(...D.temperature_2m_max) : 1;
  const sec = (v, c) => `sec v-${v} ${c} ${view === v ? "on" : ""}`;
  const share = () => { navigator.clipboard?.writeText(location.href).then(() => setToast("Ссылка скопирована")).catch(() => setToast("Скопируйте адрес из строки браузера")); };
  const A = air?.current;
  const COLORS = ["#FFB454", "#8ADBEA", "#7CF0B8", "#FF8FB1", "#B49BFF"];

  useEffect(() => {
    const c = ls("isobar-field", null);
    if (c && Date.now() - c.t < 3600000) return setField(c.d);
    const la = [], lo = [];
    for (let y = -75; y <= 75; y += 15) for (let x = -180; x < 180; x += 15) { la.push(y); lo.push(x); }
    fetch(`${FC}?latitude=${la}&longitude=${lo}&current=temperature_2m,cloud_cover,precipitation`).then((r) => r.json()).then((j) => {
      const a = Array.isArray(j) ? j : [j];
      const d = { temp: a.map((o) => o.current?.temperature_2m ?? 0), cloud: a.map((o) => o.current?.cloud_cover ?? 0), rain: a.map((o) => o.current?.precipitation ?? 0) };
      setField(d); try { localStorage.setItem("isobar-field", JSON.stringify({ t: Date.now(), d })); } catch {}
    }).catch(() => {});
  }, []);

  const cmpPlaces = useMemo(() => (place ? [place, ...favs.filter((f) => !same(f, place))].slice(0, 5) : []), [place, favs]);
  useEffect(() => {
    if (!cmpPlaces.length) return;
    fetch(`${FC}?latitude=${cmpPlaces.map((p) => p.latitude)}&longitude=${cmpPlaces.map((p) => p.longitude)}&timezone=auto&forecast_days=2&current=temperature_2m,weather_code,is_day&hourly=temperature_2m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max`)
      .then((r) => r.json()).then((j) => setCmp(Array.isArray(j) ? j : [j])).catch(() => setCmp(null));
  }, [cmpPlaces]);
  useEffect(() => { if (cur) document.title = `${T(cur.temperature_2m)}° ${place.name} · isobar`; }, [w, prefs.t]);

  const voice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return setToast("Голосовой ввод не поддерживается этим браузером");
    const r = new SR(); r.lang = "ru-RU"; r.onresult = (e) => { setQ(e.results[0][0].transcript); inp.current?.focus(); }; r.start(); setToast("Говорите…");
  };
  const alertsList = (() => {
    if (!w) return [];
    const a = [], mx = D.temperature_2m_max[1], mn = D.temperature_2m_min[1];
    const wmax = Math.max(...nextH.map((i) => H.wind_speed_10m[i] || 0));
    if (mx >= 35) a.push(["warn", `Сильная жара до ${T(mx)}°. Пейте больше воды и избегайте солнца с 12 до 17 часов.`]);
    if (mn <= -15) a.push(["warn", `Сильный мороз до ${T(mn)}°. Одевайтесь в несколько слоёв.`]);
    if (wmax >= 45) a.push(["warn", `Сильный ветер до ${Wn(wmax)} ${Wu}.`]);
    if (nextH.some((i) => WX(H.weather_code[i] ?? 0)[1] === "storm")) a.push(["bad", "В ближайшие сутки возможна гроза."]);
    if (D.precipitation_sum[1] >= 15) a.push(["warn", `Сильные осадки: около ${D.precipitation_sum[1]} мм за день.`]);
    if (D.uv_index_max[1] >= 8) a.push(["warn", `Очень высокий УФ-индекс (${Math.round(D.uv_index_max[1])}). Нужны очки и крем.`]);
    if ((A?.us_aqi || 0) > 150) a.push(["bad", `Вредный воздух (AQI ${A.us_aqi}). Сократите время на улице.`]);
    if (delta != null && Math.abs(delta) >= 8) a.push(["info", `Резкая смена температуры: ${delta > 0 ? "+" : "−"}${Math.abs(delta)}° к вчера.`]);
    return a;
  })();
  const acts = !w ? [] : (() => {
    const t = cur.apparent_temperature, pop = D.precipitation_probability_max[1], gu = cur.wind_gusts_10m, aq = A?.us_aqi || 0, hum = cur.relative_humidity_2m;
    const c = (v) => Math.max(0, Math.min(100, Math.round(v)));
    return [
      ["Пробежка", c(100 - Math.abs(t - 12) * 3 - pop * 0.4 - Math.max(0, gu - 25) - Math.max(0, aq - 50) * 0.4)],
      ["Велопрогулка", c(100 - Math.abs(t - 20) * 2.5 - pop * 0.4 - Math.max(0, gu - 20) * 1.5 - Math.max(0, aq - 50) * 0.3)],
      ["Пикник", c(100 - Math.abs(t - 24) * 3.5 - pop * 0.6 - Math.max(0, gu - 25) * 1.2)],
      ["Сушка белья", c(100 - pop * 0.8 - Math.max(0, hum - 65) * 1.2)],
      ["Полёт дрона", c(100 - Math.max(0, gu - 15) * 3 - pop * 0.5 - (cur.visibility < 5000 ? 40 : 0))],
      ["Фотосъёмка", c(100 - Math.abs(cur.cloud_cover - 40) * 0.8 - pop * 0.4 - (cur.visibility < 8000 ? 30 : 0))],
      ["Звёзды на небе", c(100 - cur.cloud_cover * 0.9 - moon.lit * 0.4 - (aq > 100 ? 20 : 0))],
    ];
  })();
  const cdiff = clim && w ? T(D.temperature_2m_max[1]) - T(clim.hi) : 0;
  const cmpRows = cmp ? cmpPlaces.map((p, i) => ({ name: p.name, color: COLORS[i], vals: (cmp[i]?.hourly?.temperature_2m || []).map(T), o: cmp[i] })).filter((r) => r.o && r.vals.length) : [];
  const cmpT = (p) => { const o = cmp?.[cmpPlaces.findIndex((x) => same(x, p))]; return o ? `${T(o.current.temperature_2m)}°` : ""; };

  return (
    <div data-theme={prefs.th} className={`app${typeof window !== "undefined" && window.chrome ? " chromium" : ""}`}>
      <div className="sky" style={{ background: `linear-gradient(180deg, ${sky[0]} 0%, ${sky[1]} 55%, ${sky[2]} 100%)`, filter: skyFilter }} />
      <div className="aur" aria-hidden><i /><i /></div><div className="tint" aria-hidden />
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <filter id="liquid" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="7" result="n" />
          <feGaussianBlur in="n" stdDeviation="2" result="b" />
          <feDisplacementMap in="SourceGraphic" in2="b" scale="22" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <Flow speed={cur?.wind_speed_10m || 8} dir={cur?.wind_direction_10m || 270} kind={kind} />
      {kind === "storm" && <div className="bolt" />}

      <header className="bar">
        <Logo />
        <form className="search" onSubmit={submit}>
          <input ref={inp} value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} placeholder="Город или место" aria-label="Город" />
          <button type="button" className="mic" onClick={voice} aria-label="Голосовой поиск"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg></button><kbd>/</kbd>
          {focus && list.length > 0 && (
            <ul className="drop">
              {q.trim().length < 2 && <li className="hint">Избранное и недавние</li>}
              {list.map((s) => (
                <li key={`${s.latitude},${s.longitude}`}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => load(s)}>
                  {favs.some((f) => same(f, s)) ? "★ " : ""}{s.name}<small>{[s.admin1, s.country].filter(Boolean).join(", ")}</small></button></li>
              ))}
            </ul>
          )}
        </form>
        <div className="tools">
          <button onClick={locate} title="Моё местоположение" aria-label="Моё местоположение"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" /><path d="M12 1v4M12 19v4M1 12h4M19 12h4" /></svg></button>
          <button onClick={() => load(place)} title="Обновить" aria-label="Обновить"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M20 12a8 8 0 11-2.5-5.8M20 4v5h-5" /></svg></button>
          <button onClick={share} title="Скопировать ссылку" aria-label="Поделиться"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6" /></svg></button>
          <button onClick={() => setMenu(!menu)} className={menu ? "on" : ""}>Настройки</button>
          {menu && (
            <div className="menu panel">
              {[["Тема", "th", [["dusk", "Сумерки"], ["aurora", "Аврора"], ["sunset", "Закат"]]], ["Температура", "t", [["C", "°C"], ["F", "°F"]]], ["Ветер", "w", [["ms", "м/с"], ["kmh", "км/ч"], ["mph", "mph"]]], ["Давление", "p", [["mm", "мм рт."], ["hpa", "гПа"]]]].map(([l, k, o]) => (
                <div key={k}><span>{l}</span><div className="seg">{o.map(([v, t]) => <button key={v} className={prefs[k] === v ? "on" : ""} onClick={() => setPrefs({ ...prefs, [k]: v })}>{t}</button>)}</div></div>
              ))}
            </div>
          )}
        </div>
      </header>

      {w && alertsList.length > 0 && <div className="alerts">{alertsList.map(([l, t]) => <div key={t} className={`al ${l}`}><i />{t}</div>)}</div>}
      {favs.length > 0 && (
        <nav className="favbar">
          {favs.map((f) => (
            <span key={`${f.latitude},${f.longitude}`} className={`chip ${place && same(f, place) ? "on" : ""}`}>
              <button onClick={() => load(f)}>{f.name}<b>{cmpT(f)}</b></button>
              <button className="x" onClick={() => setFavs(favs.filter((x) => !same(x, f)))} aria-label="Убрать из избранного">×</button>
            </span>
          ))}
        </nav>
      )}
      {err && <div className="err panel">{err}</div>}
      {loading && <div className="load"><i /></div>}

      {cur && (
        <main className={loading ? "dim" : ""} onPointerMove={(e) => {
          const p = e.target.closest?.(".panel");
          if (p) { const r = p.getBoundingClientRect(); p.style.setProperty("--lx", `${e.clientX - r.left}px`); p.style.setProperty("--ly", `${e.clientY - r.top}px`); }
        }}>
          <section className={sec("now", "hero")}>
            <p className="loc">{[place.name, place.admin1, place.country].filter(Boolean).join(", ")}</p>
            <p className="when">{new Date(cur.time).toLocaleString("ru", { weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: w.timezone })} местного времени</p>
            <div className="deg">{T(cur.temperature_2m)}<sup>°</sup></div>
            <p className="cond"><Icon k={kind} night={night} s={30} />{desc}</p>
            <p className="lead">{summary()}</p>
            <div className="pills">
              <span>Ощущается {T(cur.apparent_temperature)}°</span>
              <span>Макс {T(D.temperature_2m_max[1])}° · мин {T(D.temperature_2m_min[1])}°</span>
              {delta != null && <span>{delta === 0 ? "Как вчера" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)}° к вчера`}</span>}
              <button className={isFav ? "on" : ""} onClick={() => setFavs(isFav ? favs.filter((f) => !same(f, place)) : [...favs, place])}>{isFav ? "В избранном" : "В избранное"}</button>
            </div>
          </section>

          <section className={sec("now", "globe")}>
            <Globe lat={place.latitude} lon={place.longitude} onPick={pickGlobe} layer={layer} field={field} />
            <div className="layers">
              {[["cities", "Города"], ["temp", "Температура"], ["cloud", "Облака"], ["rain", "Осадки"]].map(([k, l]) => <button key={k} className={layer === k ? "on" : ""} onClick={() => setLayer(k)} disabled={k !== "cities" && !field}>{l}</button>)}
            </div>
            {layer !== "cities" && <div className="lgd"><i className={layer} /><span>{layer === "temp" ? `${T(-30)}°` : layer === "cloud" ? "ясно" : "сухо"}</span><span>{layer === "temp" ? `${T(40)}°` : layer === "cloud" ? "облачно" : "ливень"}</span></div>}
            <p className="cap">{Math.abs(place.latitude).toFixed(2)}° {place.latitude >= 0 ? "с. ш." : "ю. ш."}, {Math.abs(place.longitude).toFixed(2)}° {place.longitude >= 0 ? "в. д." : "з. д."}<br /><small>Нажмите на город или любую точку мира. Тяните, чтобы вращать, колесо мыши — масштаб.</small></p>
          </section>

          <section className={sec("hours", "chart-p panel")}>
            <div className="ph"><h2>{day === 1 ? "Сегодня по часам" : `${dayName(D.time[day], day)} по часам`}</h2>
              <div className="seg">{Object.entries(metrics).map(([k, m]) => <button key={k} className={metric === k ? "on" : ""} onClick={() => setMetric(k)}>{m.l}</button>)}</div></div>
            <div className="strip">
              {Array.from({ length: 12 }, (_, i) => { const k = day === 1 ? nowI + i : day * 24 + 6 + i * 2; return k < H.time.length && (
                <div key={k}><small>{i === 0 && day === 1 ? "Сейчас" : hhmm(H.time[k])}</small><Icon k={WX(H.weather_code[k])[1]} s={20} /><b>{T(H.temperature_2m[k])}°</b><small>{H.precipitation_probability[k]}%</small></div>); })}
            </div>
            <Chart vals={seg} times={times} fmt={M.fmt} nowI={day === 1 ? nowI - 24 : -1} bars={M.bars} />
            <p className="note">Наведите курсор или проведите пальцем. День выбирается в списке «Неделя».</p>
          </section>

          <section className={sec("now", "read panel")}>
            <h2>Показания</h2>
            <dl>
              <div><dt>Ветер</dt><dd>{Wn(cur.wind_speed_10m)} {Wu}, {DIRS[Math.round(cur.wind_direction_10m / 45) % 8]}
                <svg className="arrow" viewBox="0 0 20 20" width="16" height="16" style={{ transform: `rotate(${cur.wind_direction_10m + 180}deg)` }}><path d="M10 2v16M10 2L5 8M10 2l5 6" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
                <small>порывы {Wn(cur.wind_gusts_10m)}</small></dd></div>
              <div><dt>Влажность</dt><dd>{cur.relative_humidity_2m}%<i style={{ "--v": cur.relative_humidity_2m }} /></dd></div>
              <div><dt>Точка росы</dt><dd>{T(H.dew_point_2m[nowI])}°</dd></div>
              <div><dt>Давление</dt><dd>{Pr(cur.pressure_msl)}</dd></div>
              <div><dt>Облачность</dt><dd>{cur.cloud_cover}%<i style={{ "--v": cur.cloud_cover }} /></dd></div>
              <div><dt>Видимость</dt><dd>{(cur.visibility / 1000).toFixed(cur.visibility > 9999 ? 0 : 1)} км</dd></div>
              <div><dt>УФ-индекс</dt><dd>{Math.round(D.uv_index_max[1])}<i style={{ "--v": Math.min(100, (D.uv_index_max[1] / 11) * 100) }} /></dd></div>
              <div><dt>Осадки сейчас</dt><dd>{cur.precipitation} мм<small>за день {D.precipitation_sum[1]} мм</small></dd></div>
            </dl>
          </section>

          <section className={sec("days", "days panel")}>
            <h2>Неделя</h2>
            <div className="dlist">
              {D.time.map((d, i) => (
                <button key={d} className={day === i ? "on" : ""} onClick={() => { setDay(i); setView("hours"); }}>
                  <span className="dn">{dayName(d, i)}</span>
                  <Icon k={WX(D.weather_code[i])[1]} s={22} />
                  <span className="rg"><i style={{ top: `${100 - ((D.temperature_2m_max[i] - lo) / (hi - lo || 1)) * 100}%`, bottom: `${((D.temperature_2m_min[i] - lo) / (hi - lo || 1)) * 100}%` }} /></span>
                  <span className="tt"><b>{T(D.temperature_2m_max[i])}°</b><small>{T(D.temperature_2m_min[i])}°</small></span>
                  <span className="pp">{D.precipitation_probability_max[i] ?? 0}%</span>
                </button>
              ))}
            </div>
          </section>

          <section className={sec("more", "air panel")}>
            <h2>Качество воздуха</h2>
            <div className="aqi"><b style={{ color: A ? aqiCol(A.us_aqi) : "" }}>{A?.us_aqi ?? "—"}</b><span>{aqiTxt(A?.us_aqi)}</span></div>
            <div className="scale"><i style={{ left: `${Math.min(100, ((A?.us_aqi || 0) / 300) * 100)}%` }} /></div>
            <dl className="mini">
              <div><dt>PM2.5</dt><dd>{A?.pm2_5 ?? "—"}</dd></div><div><dt>PM10</dt><dd>{A?.pm10 ?? "—"}</dd></div>
              <div><dt>Озон</dt><dd>{A?.ozone ?? "—"}</dd></div><div><dt>NO₂</dt><dd>{A?.nitrogen_dioxide ?? "—"}</dd></div>
            </dl>
          </section>

          <section className={sec("more", "adv panel")}>
            <h2>Что учесть сегодня</h2>
            <div className="walk"><span>Комфорт для прогулки</span><b>{walk}/100</b><div className="meter"><i style={{ width: `${walk}%` }} /></div></div>
            <ul>{advice().map(([a, b]) => <li key={a}><b>{a}</b>{b}</li>)}</ul>
          </section>

          <section className={sec("more", "sunp panel")}>
            <h2>Солнце и Луна</h2>
            <svg viewBox="0 0 300 112" className="arcsvg">
              <path d="M20 100A130 90 0 01280 100" fill="none" stroke="rgba(255,255,255,.3)" strokeDasharray="3 5" />
              <line x1="10" x2="290" y1="100" y2="100" stroke="rgba(255,255,255,.25)" />
              {sunPct >= 0 && sunPct <= 1 && <circle cx={150 - 130 * Math.cos(Math.PI * sunPct)} cy={100 - 90 * Math.sin(Math.PI * sunPct)} r="7" fill="#FFB454" className="sunpt" />}
            </svg>
            <dl className="mini">
              <div><dt>Восход</dt><dd>{hhmm(D.sunrise[1])}</dd></div><div><dt>Закат</dt><dd>{hhmm(D.sunset[1])}</dd></div>
              <div><dt>Световой день</dt><dd>{Math.floor(dayLen / 60)} ч {Math.round(dayLen % 60)} мин</dd></div>
              <div><dt>Золотой час</dt><dd>с {new Date(Date.parse(D.sunset[1]) - 3600000).toTimeString().slice(0, 5)}</dd></div>
            </dl>
            <div className="moon"><Moon p={moon.p} /><span>{moon.name}<small>освещено {moon.lit}%</small></span></div>
          </section>

          <section className={sec("more", "act panel")}>
            <h2>Подходит ли погода для…</h2>
            <ul className="acts">{acts.map(([n, v]) => <li key={n}><span>{n}</span><b>{v >= 75 ? "отлично" : v >= 50 ? "нормально" : "лучше не стоит"}</b><div className="meter"><i style={{ width: `${v}%` }} /></div></li>)}</ul>
          </section>

          <section className={sec("more", "clim panel")}>
            <h2>Сравнение с нормой</h2>
            {clim ? (<>
              <div className="aqi"><b>{cdiff > 0 ? "+" : cdiff < 0 ? "−" : ""}{Math.abs(cdiff)}°</b><span>{cdiff > 1 ? "теплее обычного" : cdiff < -1 ? "холоднее обычного" : "как обычно"} для этой даты</span></div>
              <dl className="mini" style={{ marginTop: 10 }}>
                <div><dt>Норма днём</dt><dd>{T(clim.hi)}°</dd></div><div><dt>Норма ночью</dt><dd>{T(clim.lo)}°</dd></div>
                <div><dt>Рекорд тепла</dt><dd>{T(clim.rh)}°</dd></div><div><dt>Рекорд холода</dt><dd>{T(clim.rl)}°</dd></div>
              </dl>
              <p className="note">По данным за 10 лет, окно ±3 дня.</p>
            </>) : <p className="note">{clim === false ? "Исторические данные для этой точки недоступны." : "Загружаю исторические данные…"}</p>}
          </section>

          <section className={sec("cmp", "cmp panel")}>
            <h2>Сравнение городов</h2>
            {cmpRows.length > 0 && <CmpChart rows={cmpRows} times={cmpRows[0].o.hourly.time.map(hhmm)} />}
            <div className="ctable">
              {cmpRows.map((r) => (
                <div key={r.name + r.color}>
                  <i style={{ background: r.color }} /><b>{r.name}</b>
                  <span>{new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit", timeZone: r.o.timezone })}</span>
                  <span>{T(r.o.current.temperature_2m)}°</span>
                  <span>{T(r.o.daily.temperature_2m_max[0])}° / {T(r.o.daily.temperature_2m_min[0])}°</span>
                  <span className="pp">{r.o.daily.precipitation_probability_max[0] ?? 0}%</span>
                </div>
              ))}
            </div>
            <p className="note">{favs.length ? "Время и график по местному времени каждого города." : "Добавьте города в избранное кнопкой на главном экране, и они появятся здесь для сравнения."}</p>
          </section>
        </main>
      )}

      <footer>Данные Open-Meteo{updated ? ` · обновлено ${updated.toTimeString().slice(0, 5)}` : ""}</footer>
      {toast && <div className="toast">{toast}</div>}
      <nav className="tabs">
        {[["now", "Сейчас"], ["hours", "Часы"], ["days", "Неделя"], ["cmp", "Города"], ["more", "Ещё"]].map(([k, l]) => <button key={k} className={view === k ? "on" : ""} onClick={() => { setView(k); scrollTo(0, 0); }}>{l}</button>)}
      </nav>
    </div>
  );
}
