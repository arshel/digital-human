'use client';

import { useEffect, useRef, useState } from 'react';
import type { LiveAvatarSession } from '@heygen/liveavatar-web-sdk';
import type { Article } from '@/lib/news';

function nlDate(iso: string) {
  return new Date(iso).toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// Zichttest van de avatar: start een LiveAvatar-sessie (LITE, sandbox) en toont het beeld
// in dit kader. Nova praat hier nog niet: geen microfoon, geen spraak, geen koppeling met
// Gemini. De avatar staat stil te wachten, en dat is precies wat we willen zien.
type AvatarState = 'idle' | 'connecting' | 'live' | 'failed';

const LABELS: Record<AvatarState, string> = {
  idle: 'Nova starten',
  connecting: 'Verbinding maken…',
  live: 'Nova is actief',
  failed: 'Verbinding mislukt',
};

// Het beeld van de presentator. Kent geen chat- of nieuwslogica: alleen of Nova
// bezig is en welk artikel actief is.
export function AnchorStage({ busy, article }: { busy: boolean; article: Article | null }) {
  const [avatar, setAvatar] = useState<AvatarState>('idle');
  const [problem, setProblem] = useState('');
  const session = useRef<LiveAvatarSession | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const mounted = useRef(true);
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sessie netjes afsluiten als de pagina weggaat, anders blijft hij aan de kant van
  // LiveAvatar openstaan.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (waiting.current) clearTimeout(waiting.current);
      session.current?.stop().catch(() => {});
      session.current = null;
    };
  }, []);

  async function start() {
    // Dubbel klikken mag geen tweede sessie opleveren.
    if (session.current || avatar === 'connecting') return;
    setAvatar('connecting');
    setProblem('');

    try {
      const res = await fetch('/api/liveavatar/token', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.sessionToken) throw new Error(data?.error ?? `token gaf status ${res.status}`);

      // Pas hier laden: de SDK hoort in de browser, niet in de serverbundel.
      const { LiveAvatarSession, SessionEvent } = await import('@heygen/liveavatar-web-sdk');

      // Geen voiceChat in de config. De SDK slaat voice chat dan over, dus de browser
      // vraagt niet om de microfoon. Dat is voor deze test ook niet nodig.
      const live = new LiveAvatarSession(data.sessionToken);

      live.on(SessionEvent.SESSION_STREAM_READY, () => {
        if (waiting.current) clearTimeout(waiting.current);
        if (video.current) live.attach(video.current);
        setAvatar('live');
      });
      live.on(SessionEvent.SESSION_DISCONNECTED, () => {
        // Sandbox-sessies stoppen na ongeveer een minuut vanzelf.
        if (waiting.current) clearTimeout(waiting.current);
        session.current = null;
        if (mounted.current) setAvatar('idle');
      });

      session.current = live;
      await live.start();

      // start() is klaar zodra de verbinding staat; het beeld komt daarna pas binnen
      // (SESSION_STREAM_READY). Blijft dat uit, dan melden we dat in plaats van eindeloos
      // "Verbinding maken…" te tonen.
      waiting.current = setTimeout(() => {
        if (!mounted.current || session.current !== live) return;
        setAvatar('failed');
        setProblem('Verbonden, maar er kwam geen beeld binnen.');
        live.stop().catch(() => {});
        session.current = null;
      }, 15000);

      // Weggeklikt tijdens het verbinden: meteen weer opruimen.
      if (!mounted.current) {
        session.current = null;
        live.stop().catch(() => {});
      }
    } catch (err) {
      console.error('[liveavatar]', err);
      session.current = null;
      if (!mounted.current) return;
      setAvatar('failed');
      setProblem(err instanceof Error ? err.message : String(err));
    }
  }

  async function stop() {
    const live = session.current;
    if (waiting.current) clearTimeout(waiting.current);
    session.current = null;
    setAvatar('idle');
    setProblem('');
    await live?.stop().catch((err) => console.error('[liveavatar] stoppen mislukt:', err));
  }

  return (
    <div className="frame">
      {/* Het element staat er altijd, zodat de stream er direct in kan als hij klaar is.
          Gedempt: de avatar zegt nog niets, en zo blokkeert de browser het afspelen niet. */}
      <video
        ref={video}
        className="avatar-video"
        hidden={avatar !== 'live'}
        autoPlay
        playsInline
        muted
        disablePictureInPicture
      />

      {avatar !== 'live' && (
        <div className="face" aria-hidden="true">N</div>
      )}

      {busy && (
        <div className="talking" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      )}

      <div className="avatar-controls">
        <span className="avatar-state" aria-live="polite">{LABELS[avatar]}</span>
        {avatar === 'idle' || avatar === 'failed' ? (
          <button type="button" onClick={start}>Start Nova</button>
        ) : (
          <button type="button" onClick={stop} disabled={avatar === 'connecting'}>Stop</button>
        )}
      </div>

      {/* Alleen tijdens ontwikkelen: de reden waarom het misging. Nooit de API-key: die
          blijft op de server en komt niet in dit antwoord voor. */}
      {problem && process.env.NODE_ENV === 'development' && <p className="avatar-problem">{problem}</p>}

      <div className="lower-third" key={article?.id ?? 'briefing'}>
        <span className="lt-name">Nova, nieuwspresentator</span>
        <span className="lt-source">
          {article ? (
            <>
              {article.source}, {nlDate(article.published)}
              <a href={article.sourceUrl} target="_blank" rel="noreferrer">
                bron openen
              </a>
            </>
          ) : (
            'Het nieuws van vandaag'
          )}
        </span>
      </div>
    </div>
  );
}
