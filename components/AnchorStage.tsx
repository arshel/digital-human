'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LiveAvatarSession } from '@heygen/liveavatar-web-sdk';

// Het beeld van de presentator: een LiveAvatar-sessie (LITE-modus, sandbox, avatar Wayne).
// Wat deze integratie wel en niet kan (gecontroleerd in @heygen/liveavatar-web-sdk 0.0.19):
// - Beeld: ja. De stream komt in de <video>, in de eigen verhouding, nooit uitgerekt.
// - Spraak: nee. In LITE-modus spreekt de avatar alleen audio die wij zelf aanleveren
//   (repeatAudio, PCM 24 kHz) en die is er nog niet. repeat(tekst) werkt alleen in FULL-modus.
//   Daarom is de video gedempt en is er geen pauzeknop: er valt niets te pauzeren.
// - Pauzeren en hervatten: de SDK kent alleen interrupt() (stoppen), geen pauze.
// - Microfoon: uit. Zonder voiceChat in de config start de SDK geen spraakchat.
// De sessie start alleen als de gebruiker daarom vraagt (startRequest), nooit bij het laden.
// Kent geen nieuws of AI: alleen of het beeld moet starten en waar het vrij moet blijven.

export type AvatarStatus = 'idle' | 'connecting' | 'live' | 'failed' | 'ended';

// Plekken in het vlak (in px vanaf linksboven) waar tekst en knoppen over het beeld liggen.
export type KeepClear = { top: { left: number; right: number; bottom: number } | null; bottom: number };

// Waar het gezicht van Wayne in het beeld zit, als deel van breedte en hoogte. Gemeten op de
// echte stream: haar vanaf ~10%, kin tot ~62%, hoofd tussen ~40% en ~64% van de breedte. Hier
// met wat marge. Een andere avatar? Dan opnieuw meten.
const FACE = { top: 0.08, bottom: 0.64, left: 0.36, right: 0.68 };
const GAP = 12;

type Box = { x: number; y: number; w: number; h: number };

// Zo groot mogelijk in de eigen verhouding, zonder dat tekst of knoppen over het gezicht
// vallen. Past het niet, dan stap voor stap kleiner: liever een kleinere presentator dan een
// bedekt gezicht. Is er ruimte over (een hoge telefoon), dan staat het gezicht midden in de
// vrije ruimte; anders staat de presentator bovenaan, zoals in het ontwerp.
function fit(width: number, height: number, ratio: number, clear: KeepClear): Box | null {
  if (!width || !height) return null;
  let box: Box | null = null;
  for (let h = Math.min(height, width / ratio), i = 0; i < 80 && h > 48; i++, h *= 0.97) {
    const w = h * ratio;
    const x = (width - w) / 2;
    const top = clear.top;
    const overlapsTop = top !== null && top.right + GAP > x + FACE.left * w && top.left - GAP < x + FACE.right * w;
    const free = overlapsTop ? top.bottom + GAP : 0;
    const lowest = Math.max(0, free - FACE.top * h);
    const highest = Math.min(height - h, clear.bottom - GAP - FACE.bottom * h);
    const centred = (free + clear.bottom) / 2 - ((FACE.top + FACE.bottom) / 2) * h;
    box = { x, y: Math.min(Math.max(centred, lowest), Math.max(highest, lowest)), w, h };
    if (lowest <= highest) return box;
  }
  return box;
}

export function AnchorStage({
  startRequest,
  onStatus,
  keepClear,
}: {
  startRequest: number;
  onStatus: (status: AvatarStatus) => void;
  keepClear: KeepClear;
}) {
  const [status, setStatus] = useState<AvatarStatus>('idle');
  const [problem, setProblem] = useState('');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ratio, setRatio] = useState(16 / 9);
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<LiveAvatarSession | null>(null);
  const mounted = useRef(true);
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => onStatus(status), [status, onStatus]);

  // Sessie netjes afsluiten als de pagina weggaat, anders blijft hij bij LiveAvatar openstaan.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (waiting.current) clearTimeout(waiting.current);
      session.current?.stop().catch(() => {});
      session.current = null;
    };
  }, []);

  // Tabblad weggeklikt of telefoon op slot: sessie stoppen. Kijken kan dan toch niet, en een
  // eigen avatar kost credits per minuut. Opnieuw starten gaat alleen op verzoek.
  useEffect(() => {
    const hide = () => {
      const live = session.current;
      if (!document.hidden || !live) return;
      if (waiting.current) clearTimeout(waiting.current);
      session.current = null;
      live.stop().catch(() => {});
      setStatus('ended');
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const update = () =>
      setSize((s) =>
        s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight },
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (startRequest > 0) start();
    // start() gebruikt alleen refs en setters; alleen een nieuw verzoek mag een sessie starten.
  }, [startRequest]);

  async function start() {
    // Dubbel klikken mag geen tweede sessie opleveren.
    if (session.current) return;
    setStatus('connecting');
    setProblem('');

    try {
      const res = await fetch('/api/liveavatar/token', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.sessionToken) throw new Error(data?.error ?? `token gaf status ${res.status}`);

      // Pas hier laden: de SDK hoort in de browser, niet in de serverbundel.
      const { LiveAvatarSession, SessionEvent } = await import('@heygen/liveavatar-web-sdk');
      const live = new LiveAvatarSession(data.sessionToken);
      let ready = false;

      live.on(SessionEvent.SESSION_STREAM_READY, () => {
        ready = true;
        if (waiting.current) clearTimeout(waiting.current);
        if (video.current) live.attach(video.current);
        if (mounted.current) setStatus('live');
      });
      live.on(SessionEvent.SESSION_DISCONNECTED, () => {
        // Sandbox-sessies stoppen na ongeveer een minuut vanzelf, andere na het plafond uit de tokenroute.
        if (waiting.current) clearTimeout(waiting.current);
        if (session.current !== live) return;
        session.current = null;
        if (mounted.current) setStatus(ready ? 'ended' : 'failed');
      });

      session.current = live;
      await live.start();

      // Het beeld komt na de verbinding binnen. Blijft het uit, dan dat melden in plaats van
      // eindeloos te wachten. (Kwam het al tijdens start(), dan is er niets te doen.)
      if (!ready) {
        waiting.current = setTimeout(() => {
          if (!mounted.current || session.current !== live || ready) return;
          session.current = null;
          live.stop().catch(() => {});
          setStatus('failed');
          setProblem('Verbonden, maar er kwam geen beeld binnen.');
        }, 15000);
      }

      // Weggeklikt tijdens het verbinden: meteen weer opruimen.
      if (!mounted.current) {
        session.current = null;
        live.stop().catch(() => {});
      }
    } catch (err) {
      console.error('[liveavatar]', err);
      session.current = null;
      if (!mounted.current) return;
      setStatus('failed');
      setProblem(err instanceof Error ? err.message : String(err));
    }
  }

  function measure() {
    const v = video.current;
    if (v?.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
  }

  // Eén stilstaand, vervaagd beeld voor de ruimte naast en boven de video, zodat het beeld
  // rustig doorloopt zonder bewegende achtergrond. Alleen de linker- en rechterrand van het
  // beeld (het decor), niet de presentator zelf: anders staat er op een telefoon een groot
  // vaag hoofd boven het echte.
  function snapshot() {
    const v = video.current;
    if (!mounted.current || !v?.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 36;
    const strip = v.videoWidth * 0.12;
    try {
      const g = c.getContext('2d');
      g?.drawImage(v, 0, 0, strip, v.videoHeight, 0, 0, 32, 36);
      g?.drawImage(v, v.videoWidth - strip, 0, strip, v.videoHeight, 32, 0, 32, 36);
      setBackdrop(c.toDataURL('image/jpeg', 0.7));
    } catch {
      // Lukt het niet, dan blijft de effen achtergrond staan.
    }
  }

  const box = useMemo(() => fit(size.width, size.height, ratio, keepClear), [size, ratio, keepClear]);
  const face = box && {
    left: box.x + box.w / 2,
    top: box.y + ((FACE.top + FACE.bottom) / 2) * box.h,
    size: Math.min(Math.max(box.h * 0.42, 64), 176),
  };

  return (
    <div ref={root} className={`presenter${status === 'live' ? ' is-live' : ''}${backdrop ? ' has-backdrop' : ''}`}>
      <div
        className="presenter-backdrop"
        aria-hidden="true"
        style={backdrop ? { backgroundImage: `url(${backdrop})` } : undefined}
      />
      {/* Gedempt: de avatar zegt nog niets (zie boven), en zo blokkeert de browser het afspelen niet. */}
      <video
        ref={video}
        className="presenter-video"
        style={box ? { left: box.x, top: box.y, width: box.w, height: box.h } : undefined}
        hidden={status !== 'live'}
        autoPlay
        playsInline
        muted
        disablePictureInPicture
        aria-label="Beeld van Nova, de AI-presentator, zonder geluid"
        onLoadedMetadata={measure}
        onPlaying={() => setTimeout(snapshot, 500)}
      />

      {status !== 'live' && (
        <div
          className="presenter-placeholder"
          aria-hidden="true"
          style={
            face ? { left: face.left, top: face.top, width: face.size, height: face.size, fontSize: face.size * 0.42 } : undefined
          }
        >
          N
        </div>
      )}

      {/* Alleen tijdens ontwikkelen: de reden waarom het misging. Nooit de API-key: die blijft
          op de server en komt niet in dit antwoord voor. */}
      {problem && process.env.NODE_ENV === 'development' && <p className="presenter-problem">{problem}</p>}
    </div>
  );
}
