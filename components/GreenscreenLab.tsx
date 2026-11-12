"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { GreenScreenCanvas } from "@/components/GreenScreenCanvas";
import { NewsBackdrop } from "@/components/NewsBackdrop";
import { webglAvailable } from "@/components/presenter/greenscreen";
import { DEFAULT_KEY, DEFAULT_LAYOUT, layoutVars, type KeySettings, type Placement, type PresenterLayout } from "@/lib/greenscreen";

// Testpagina voor Nova vrijstaand (alleen `npm run dev`): dezelfde onderdelen en CSS als de echte
// pagina, met testmateriaal dat de browser zelf tekent. Geen Anam, geen kosten, geen bestanden.
// Instellen via de knoppen of de adresbalk (voor schermafbeeldingen):
//   ?bron=video|beeld|mp4|nova|colbert-frontaal|colbert-breed|colbert-gedraaid
//   ?achtergrond=nieuws|geen|kapot   ?webgl=uit   ?live=1
// De colbert-bronnen zijn de drie colbert-avatars van Anam (public/anam/varianten/): hun wachtvideo,
// met dezelfde uitsnede en compressie als de stream.
// bron=nova is een beeld uit de Anam-stream van de greenscreen-Nova (public/anam/nova-groen-stream.png):
// het echte gezicht, met de videocompressie van de stream.
// bron=mp4 is de gewone wachtvideo van Nova (geen greenscreen): die blijft dus rechthoekig, maar
// laat zien dat videobeelden door WebGL komen. Chrome zonder venster (headless) geeft lege beelden
// uit het getekende testfilmpje; met mp4 is de videoweg daar toch te controleren.

const W = 1152;
const H = 768;

// Het testbeeld: geen Nova, maar duidelijk herkenbaar. Een groen scherm met ongelijk licht (zoals
// in het echt), een figuur met haarpieken (lastige randen), een groene glans op de randen (spill)
// en een klokje dat laat zien dat het filmpje loopt.
function drawTestFrame(ctx: CanvasRenderingContext2D, t: number) {
  const g = ctx.createRadialGradient(W / 2, H * 0.4, 50, W / 2, H / 2, W * 0.7);
  g.addColorStop(0, "#14c24f");
  g.addColorStop(1, "#009a3a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const bob = Math.sin(t * 2) * 8;
  const cx = W / 2;
  const figure = () => {
    ctx.beginPath();
    // Schouders en romp.
    ctx.moveTo(cx - 300, H);
    ctx.bezierCurveTo(cx - 300, H - 170, cx - 230, H - 230, cx - 90, H - 250);
    ctx.lineTo(cx + 90, H - 250);
    ctx.bezierCurveTo(cx + 230, H - 230, cx + 300, H - 170, cx + 300, H);
    ctx.closePath();
    // Hoofd.
    ctx.moveTo(cx + 105, 250 + bob);
    ctx.ellipse(cx, 250 + bob, 105, 130, 0, 0, Math.PI * 2);
  };

  // Groene glans rond de figuur, zoals licht van een groen scherm op haar en schouders.
  ctx.save();
  ctx.shadowColor = "rgba(40, 230, 90, 0.9)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#1d2c4a";
  figure();
  ctx.fill();
  ctx.restore();

  // Romp met een licht vlak (overhemd) en het label.
  ctx.fillStyle = "#e9eef5";
  ctx.beginPath();
  ctx.moveTo(cx - 70, H);
  ctx.lineTo(cx - 70, H - 245);
  ctx.lineTo(cx, H - 170);
  ctx.lineTo(cx + 70, H - 245);
  ctx.lineTo(cx + 70, H);
  ctx.fill();
  ctx.fillStyle = "#c2410c";
  ctx.font = "bold 44px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("TESTBEELD", cx, H - 70);
  ctx.font = "bold 22px system-ui, sans-serif";
  ctx.fillText("geen Nova", cx, H - 38);

  // Gezicht.
  ctx.fillStyle = "#e0b48f";
  ctx.beginPath();
  ctx.ellipse(cx, 265 + bob, 88, 110, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1d2c4a";
  ctx.fillRect(cx - 45, 245 + bob, 22, 10);
  ctx.fillRect(cx + 23, 245 + bob, 22, 10);
  ctx.beginPath();
  ctx.ellipse(cx, 320 + bob, 30, 6 + Math.abs(Math.sin(t * 9)) * 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Haar: pieken met dunne punten, de moeilijkste randen voor groenverwijdering.
  ctx.fillStyle = "#2b1d14";
  ctx.beginPath();
  ctx.moveTo(cx - 110, 230 + bob);
  for (let i = 0; i <= 22; i++) {
    const x = cx - 110 + i * 10;
    const y = (i % 2 ? 105 : 140) + bob + Math.sin(i + t * 3) * 4;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(cx + 110, 230 + bob);
  ctx.quadraticCurveTo(cx, 170 + bob, cx - 110, 230 + bob);
  ctx.fill();

  // Klokje: loopt alleen in het filmpje.
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`t = ${t.toFixed(1)} s`, 40, 60);
}

function param(name: string) {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

type Background = "nieuws" | "geen" | "kapot";
const PORTRAITS = ["colbert-frontaal", "colbert-breed", "colbert-gedraaid"] as const;
const SOURCES = ["video", "beeld", "mp4", "nova", ...PORTRAITS] as const;
type Source = (typeof SOURCES)[number];

// ?alleen=testbeeld: alleen het testbeeld, op ware grootte. Om het als bestand vast te leggen
// (public/greenscreen-test/testbeeld.png), voor een test van de echte pagina.
function RawTestFrame() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx) drawTestFrame(ctx, 0);
  }, []);
  return (
    <>
      {/* Het ontwikkelknopje van Next.js niet mee in het beeld. */}
      <style>{"nextjs-portal{display:none!important}"}</style>
      <canvas ref={ref} width={W} height={H} style={{ position: "fixed", left: 0, top: 0, display: "block" }} />
    </>
  );
}

export function GreenscreenLab() {
  const [raw, setRaw] = useState(false);
  useEffect(() => {
    setRaw(param("alleen") === "testbeeld");
  }, []);
  return raw ? <RawTestFrame /> : <Lab />;
}

function Lab() {
  const [source, setSource] = useState<Source>("video");
  const [background, setBackground] = useState<Background>("nieuws");
  const [forceFallback, setForceFallback] = useState(false);
  const [live, setLive] = useState(false);
  const [keySettings, setKeySettings] = useState<KeySettings>(DEFAULT_KEY);
  const [layout, setLayout] = useState<PresenterLayout>(DEFAULT_LAYOUT);
  const [newsImage, setNewsImage] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const mp4 = useRef<HTMLVideoElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const nova = useRef<HTMLImageElement>(null);
  const portraits = useRef<Record<string, HTMLVideoElement | null>>({});

  useEffect(() => {
    const bron = param("bron");
    setSource(SOURCES.includes(bron as Source) ? (bron as Source) : "video");
    const bg = param("achtergrond");
    setBackground(bg === "geen" || bg === "kapot" ? bg : "nieuws");
    setForceFallback(param("webgl") === "uit");
    setLive(param("live") === "1");
    setWebgl(webglAvailable());
    fetch("/api/news")
      .then((r) => r.json())
      .then((d) => setNewsImage(d.articles?.find((a: { image?: string }) => a.image)?.image ?? null))
      .catch(() => setNewsImage(null));
  }, []);

  // Het testfilmpje: een canvas dat de browser zelf tekent, als videostroom. Plus één stilstaand
  // beeld daarvan, voor het wachtbeeld.
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawTestFrame(ctx, 0);
    setPoster(canvas.toDataURL("image/png"));
    const start = performance.now();
    let frame = requestAnimationFrame(function loop() {
      drawTestFrame(ctx, (performance.now() - start) / 1000);
      frame = requestAnimationFrame(loop);
    });
    const stream = canvas.captureStream(30);
    if (video.current) video.current.srcObject = stream;
    return () => {
      cancelAnimationFrame(frame);
      stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Wat het testfilmpje zelf laat zien: maat en de kleur van een pixel naast de figuur. Zo is te
  // zien of een zwart vlak van de bron komt of van het canvas.
  const [probe, setProbe] = useState("");
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const timer = setInterval(() => {
      const v = video.current;
      if (!v || !ctx) return;
      try {
        ctx.drawImage(v, v.videoWidth * 0.1, v.videoHeight * 0.5, 1, 1, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        setProbe(`${v.videoWidth}x${v.videoHeight}, readyState ${v.readyState}, pixel ${r},${g},${b}`);
      } catch (e) {
        setProbe(String(e));
      }
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const fail = useCallback((reason: string) => setFailed(reason), []);
  const keyed = !forceFallback && webgl === true && !failed;
  const style = useMemo(() => layoutVars(layout) as CSSProperties, [layout]);
  const bgImage = background === "nieuws" ? newsImage : background === "kapot" ? "https://images.cdn.nos.nl/bestaat-niet.webp" : null;
  const still = () => (source === "nova" ? nova.current : (portraits.current[source] ?? null));
  const liveSource = () =>
    source === "video" ? video.current : source === "mp4" ? mp4.current : source === "beeld" ? image.current : still();
  const restSource = () => still() ?? image.current;
  const fade: CSSProperties = { opacity: live ? 0 : 1, transition: "opacity 450ms ease" };

  const frame = (kind: "computer" | "telefoon", size: CSSProperties) => (
    <figure className="lab-figure">
      <figcaption>{kind}</figcaption>
      <div className={`frame${keyed ? " is-keyed" : ""}`} style={{ ...size, ...(keyed ? style : {}) }}>
        <NewsBackdrop image={bgImage} publisher="NOS" focus="50% 40%" />
        {keyed ? (
          <>
            <GreenScreenCanvas className="nova-layer" source={liveSource} keySettings={keySettings} onFail={fail} />
            <GreenScreenCanvas className="nova-layer" style={fade} source={restSource} keySettings={keySettings} onFail={fail} />
          </>
        ) : (
          // Terugval: de rechthoekige video zoals in de gewone weergave.
          poster && <img className="frame-media" src={poster} alt="Terugval: rechthoekig beeld" />
        )}
        <p className="ai-label">
          <span className="on-air-dot" /> AI-presentator
        </p>
        <p className="lab-caption">Zo leest de ondertiteling over de afbeelding en de presentator heen.</p>
      </div>
    </figure>
  );

  const slider = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void) => (
    <label className="lab-slider">
      <span>
        {label}: {value}
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
    </label>
  );
  const place = (which: keyof PresenterLayout, field: keyof Omit<Placement, "side">, v: number) =>
    setLayout((l) => ({ ...l, [which]: { ...l[which], [field]: v } }));

  return (
    <main className="lab">
      <h1>Greenscreen-test</h1>
      <p>
        Testmateriaal, geen Nova. WebGL: <strong>{webgl === null ? "…" : webgl ? "werkt" : "werkt niet"}</strong>. Weergave:{" "}
        <strong data-testid="mode">{keyed ? "vrijstaand" : "terugval (rechthoekig)"}</strong>
        {failed && <> · mislukt: {failed}</>}
        <br />
        Testfilmpje: <span data-testid="probe">{probe || "…"}</span>
      </p>
      <div className="lab-controls">
        <button
          type="button"
          onClick={() => setSource(SOURCES[(SOURCES.indexOf(source) + 1) % SOURCES.length])}
        >
          Bron: {source}
        </button>
        <button type="button" onClick={() => setBackground(background === "nieuws" ? "geen" : background === "geen" ? "kapot" : "nieuws")}>
          Achtergrond: {background}
        </button>
        <button type="button" onClick={() => setLive(!live)}>{live ? "Terug naar wachtbeeld" : "Wissel naar live"}</button>
        <button type="button" onClick={() => (setForceFallback(!forceFallback), setFailed(null))}>
          {forceFallback ? "WebGL weer aan" : "Doe alsof WebGL ontbreekt"}
        </button>
      </div>
      <div className="lab-controls">
        {slider("minGreen", keySettings.minGreen, 0, 1, 0.01, (v) => setKeySettings({ ...keySettings, minGreen: v }))}
        {slider("greenBias", keySettings.greenBias, 0, 0.5, 0.01, (v) => setKeySettings({ ...keySettings, greenBias: v }))}
        {slider("softness", keySettings.softness, 0.01, 0.5, 0.01, (v) => setKeySettings({ ...keySettings, softness: v }))}
        {slider("spill", keySettings.spill, 0, 1, 0.05, (v) => setKeySettings({ ...keySettings, spill: v }))}
      </div>
      <div className="lab-controls">
        {slider("computer: afstand rechts", layout.desktop.inset, -60, 60, 1, (v) => place("desktop", "inset", v))}
        {slider("computer: hoogte", layout.desktop.height, 30, 160, 1, (v) => place("desktop", "height", v))}
        {slider("telefoon: verschuiving", layout.mobile.inset, -60, 60, 1, (v) => place("mobile", "inset", v))}
        {slider("telefoon: hoogte", layout.mobile.height, 30, 160, 1, (v) => place("mobile", "height", v))}
      </div>
      <div className="lab-frames">
        {frame("computer", { width: 900, height: 600 })}
        {frame("telefoon", { width: 360, height: 360 })}
      </div>
      {/* De bronnen, onzichtbaar, zoals in de echte pagina. */}
      <video ref={video} className="lab-hidden" autoPlay muted playsInline />
      <video ref={mp4} className="lab-hidden" src="/anam/nova-idle.mp4" autoPlay muted loop playsInline />
      {poster && <img ref={image} className="lab-hidden" src={poster} alt="" />}
      <img ref={nova} className="lab-hidden" src="/anam/nova-groen-stream.png" alt="" />
      {PORTRAITS.map((name) => (
        <video
          key={name}
          ref={(el) => {
            portraits.current[name] = el;
          }}
          className="lab-hidden"
          src={`/anam/varianten/${name}-idle.mp4`}
          poster={`/anam/varianten/${name}-landscape.webp`}
          autoPlay
          muted
          loop
          playsInline
        />
      ))}
      <pre className="lab-settings">{JSON.stringify({ key: keySettings, layout }, null, 1)}</pre>
    </main>
  );
}
