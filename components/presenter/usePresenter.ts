'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnamPresenter } from './anam.ts';
import { SimulatedPresenter } from './simulated.ts';
import { idleTimerRuns, type ListenState, type Presenter, type PresenterState, type Timing, type TimingEvent } from './types.ts';

// Verbindt de pagina met de presentator (gesimuleerd of Anam). Ruimt de verbinding op bij
// afsluiten, bij een verborgen tabblad en na een tijd zonder activiteit, zodat een vergeten
// tabblad geen Anam-minuten blijft gebruiken.

const IDLE_MS = 2 * 60 * 1000;

// `busy`: de pagina maakt nog een antwoord (het taalmodel loopt). Dan geen inactiviteitstimer.
// `onTiming`: meetpunten van de presentator, voor de ontwikkelserver.
// `onHeard`: een gesproken vraag, zoals Anam die verstond.
// `greenscreen`: Anam om de greenscreenversie van Nova vragen (de pagina toont die vrijstaand),
// en welke variant (`variant`, of null voor de standaard).
export function usePresenter(
  mode: 'simulated' | 'anam' | null,
  busy = false,
  onTiming?: (event: TimingEvent) => void,
  onHeard?: (text: string) => void,
  greenscreen = false,
  variant: string | null = null,
) {
  const video = useRef<HTMLVideoElement>(null);
  const engine = useRef<Presenter | null>(null);
  const [state, setState] = useState<PresenterState>('idle');
  const [detail, setDetail] = useState('');
  const [sentence, setSentence] = useState(-1);
  const [timing, setTiming] = useState<Timing>('none');
  const [listening, setListening] = useState<ListenState>('off');
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timingRef = useRef(onTiming);
  timingRef.current = onTiming;
  const heardRef = useRef(onHeard);
  heardRef.current = onHeard;
  const greenscreenRef = useRef({ greenscreen, variant });
  greenscreenRef.current = { greenscreen, variant };
  // Geldt voor de volgende verbinding: een lopende stream wisselt niet van avatar.
  if (engine.current instanceof AnamPresenter) Object.assign(engine.current, { greenscreen, variant });

  const get = useCallback(() => {
    if (!engine.current && mode) {
      const events = {
        onState: (s: PresenterState, d = '') => {
          setState(s);
          setDetail(d);
        },
        onSentence: setSentence,
        onTiming: (event: TimingEvent) => timingRef.current?.(event),
        onListening: setListening,
        onHeard: (text: string) => heardRef.current?.(text),
      };
      engine.current = mode === 'anam' && video.current ? new AnamPresenter(video.current, events) : new SimulatedPresenter(events);
      if (engine.current instanceof AnamPresenter) Object.assign(engine.current, greenscreenRef.current);
      setTiming(engine.current.timing);
    }
    return engine.current;
  }, [mode]);

  // Na 2 minuten echt stilstaan: verbinding dicht. De volgende knop verbindt opnieuw. De timer
  // begint pas als Nova klaar is (of gepauzeerd), niet bij het begin van het spreken, en loopt
  // nooit tijdens genereren, verbinden, spreken of luisteren (zie idleTimerRuns).
  useEffect(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    if (!idleTimerRuns(state, busy || listening === 'on')) return;
    idleTimer.current = setTimeout(() => {
      engine.current?.disconnect('idle');
    }, IDLE_MS);
  }, [state, busy, listening]);

  useEffect(() => {
    if (state === 'speaking' && engine.current) setTiming(engine.current.timing);
  }, [state]);

  // De Anam-SDK alvast laden (een bestand van onze eigen server, geen verbinding met Anam), zodat
  // Start daar niet op wacht.
  useEffect(() => {
    if (mode === 'anam') import('@anam-ai/js-sdk').catch(() => {});
  }, [mode]);

  useEffect(() => {
    const hidden = () => {
      if (document.hidden) engine.current?.disconnect('hidden');
    };
    const leave = () => {
      engine.current?.disconnect();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', leave);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      engine.current?.disconnect();
      engine.current = null;
    };
  }, []);

  return {
    video,
    state,
    detail,
    sentence,
    timing,
    // Gesproken vragen kunnen alleen met Anam.
    canListen: mode === 'anam',
    listening,
    // Gelezen tijdens het renderen; elke statuswijziging rendert opnieuw.
    canResume: engine.current?.canResume ?? false,
    connect: () => get()?.connect() ?? Promise.resolve(false),
    speak: (sentences: string[], cycle?: number, from = 0) => get()?.speak(sentences, from, cycle) ?? Promise.resolve(),
    pause: () => get()?.pause(),
    resume: () => get()?.resume(),
    replay: () => get()?.replay(),
    stop: () => get()?.stop(),
    listen: () => get()?.listen?.(),
    stopListening: () => get()?.stopListening?.(),
    simulateDrop: () => {
      const e = get();
      if (e instanceof SimulatedPresenter) e.simulateDrop();
      else e?.disconnect('dropped');
    },
  };
}
