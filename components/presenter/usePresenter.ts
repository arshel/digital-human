'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnamPresenter } from './anam.ts';
import { DidPresenter } from './did.ts';
import { SimulatedPresenter } from './simulated.ts';
import { idleTimerRuns, type PauseKind, type Presenter, type PresenterState, type Timing, type TimingEvent } from './types.ts';

// Verbindt de pagina met de presentator (gesimuleerd of D-ID). Ruimt de verbinding op bij
// afsluiten, bij een verborgen tabblad en na een tijd zonder activiteit, zodat een vergeten
// tabblad geen streamingtegoed blijft gebruiken.

const IDLE_MS = 2 * 60 * 1000;

// `busy`: de pagina maakt nog een antwoord (het taalmodel loopt). Dan geen inactiviteitstimer.
// `onTiming`: meetpunten van de presentator, voor de ontwikkelserver.
export function usePresenter(mode: 'simulated' | 'did' | 'anam' | null, busy = false, onTiming?: (event: TimingEvent) => void) {
  const video = useRef<HTMLVideoElement>(null);
  const idleVideo = useRef<HTMLVideoElement>(null);
  const engine = useRef<Presenter | null>(null);
  const [state, setState] = useState<PresenterState>('idle');
  const [detail, setDetail] = useState('');
  const [sentence, setSentence] = useState(-1);
  const [timing, setTiming] = useState<Timing>('none');
  const [pauseKind, setPauseKind] = useState<PauseKind>('stop');
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timingRef = useRef(onTiming);
  timingRef.current = onTiming;

  const get = useCallback(() => {
    if (!engine.current && mode) {
      const events = {
        onState: (s: PresenterState, d = '') => {
          setState(s);
          setDetail(d);
          if (engine.current) setPauseKind(engine.current.pauseKind);
        },
        onSentence: setSentence,
        onTiming: (event: TimingEvent) => timingRef.current?.(event),
      };
      engine.current =
        mode === 'did' && video.current
          ? new DidPresenter(video.current, events, undefined, idleVideo.current)
          : mode === 'anam' && video.current
            ? new AnamPresenter(video.current, events)
            : new SimulatedPresenter(events);
      setTiming(engine.current.timing);
    }
    return engine.current;
  }, [mode]);

  // Na 2 minuten echt stilstaan: verbinding dicht. De volgende knop verbindt opnieuw. De timer
  // begint pas als Nova klaar is (of gepauzeerd), niet bij het begin van het spreken, en loopt
  // nooit tijdens genereren, verbinden of spreken (zie idleTimerRuns).
  useEffect(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    if (!idleTimerRuns(state, busy)) return;
    idleTimer.current = setTimeout(() => {
      engine.current?.disconnect('idle');
    }, IDLE_MS);
  }, [state, busy]);

  useEffect(() => {
    if (state === 'speaking' && engine.current) setTiming(engine.current.timing);
  }, [state]);

  // De D-ID-SDK alvast laden (een bestand van onze eigen server, geen verbinding met D-ID), zodat
  // Start daar niet op wacht.
  useEffect(() => {
    if (mode === 'did') import('@d-id/client-sdk').catch(() => {});
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
    idleVideo,
    state,
    detail,
    sentence,
    timing,
    pauseKind,
    // Gelezen tijdens het renderen; elke statuswijziging rendert opnieuw.
    canResume: engine.current?.canResume ?? false,
    connect: () => get()?.connect() ?? Promise.resolve(false),
    speak: (sentences: string[], cycle?: number) => get()?.speak(sentences, 0, cycle) ?? Promise.resolve(),
    pause: () => get()?.pause(),
    resume: () => get()?.resume(),
    replay: () => get()?.replay(),
    stop: () => get()?.stop(),
    simulateDrop: () => {
      const e = get();
      if (e instanceof SimulatedPresenter) e.simulateDrop();
      else e?.disconnect('dropped');
    },
  };
}
