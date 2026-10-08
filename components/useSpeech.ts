'use client';

import { useEffect, useRef, useState } from 'react';

// Voorlezen met de stem van de browser (Web Speech API). Geen extra dienst en geen sleutel: de
// browser of het besturingssysteem spreekt zelf. Kiest Chrome een stem van Google, dan gaat de
// tekst daarvoor wel naar Google.
//
// Elke zin is een eigen uiting. Zo weten we welke zin klinkt: het start-event van de stem, geen
// geschatte timing. Pauze zet de stem echt stil; verder luisteren begint de onderbroken zin
// opnieuw. pause() en resume() van de browser gebruiken we niet: op Android stopt pause() de stem
// helemaal, en stemmen van Google in Chrome hervatten soms niet.
//
// De mond van de avatar beweegt niet mee. LiveAvatar (LITE) beweegt alleen op audio die wij zelf
// aanleveren (repeatAudio, PCM 24 kHz), en de browser geeft het geluid van zijn stem niet vrij.

export type SpeechState = 'idle' | 'speaking' | 'paused' | 'done';

// Iets rustiger dan normaal. Dit is het echte spreektempo van de stem, niet alleen kortere zinnen.
const RATE = 0.9;

// Een Nederlandse stem. Nederlands uit Nederland, een natuurlijk klinkende stem en een stem op het
// apparaat zelf gaan voor. Geen Nederlandse stem? Dan geen voorlezen: een Engelse stem die
// Nederlands uitspreekt, is niet te volgen.
function dutchVoice(voices: SpeechSynthesisVoice[]) {
  let best: SpeechSynthesisVoice | null = null;
  let top = 0;
  for (const v of voices) {
    if (!/^nl([-_]|$)/i.test(v.lang)) continue;
    const score =
      1 +
      (/^nl[-_]nl/i.test(v.lang) ? 4 : 0) +
      (/natural|neural|premium|enhanced|google/i.test(v.name) ? 2 : 0) +
      (v.localService ? 1 : 0);
    if (score > top) {
      best = v;
      top = score;
    }
  }
  return best;
}

export function useSpeech() {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<SpeechState>('idle');
  // De zin die nu klinkt (of bij een pauze: waar het verder gaat). -1: geen.
  const [index, setIndex] = useState(-1);
  const voice = useRef<SpeechSynthesisVoice | null>(null);
  const lines = useRef<string[]>([]);
  const at = useRef(0);
  // Elke start of stop begint een nieuwe beurt. Events van een eerdere beurt tellen niet meer;
  // ook het afbreken zelf meldt de browser met een event.
  const run = useRef(0);
  // Vasthouden: zonder verwijzing ruimt Chrome de uiting soms op en blijven de events weg.
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const pick = () => {
      voice.current = dutchVoice(synth.getVoices());
      setAvailable(voice.current !== null);
    };
    const quiet = () => {
      run.current++;
      synth.cancel();
    };
    quiet(); // een stem die na herladen nog doorpraat
    pick();
    // Chrome laadt de stemmen pas na een tijdje.
    synth.addEventListener('voiceschanged', pick);
    window.addEventListener('pagehide', quiet);
    return () => {
      synth.removeEventListener('voiceschanged', pick);
      window.removeEventListener('pagehide', quiet);
      quiet();
    };
  }, []);

  function say(i: number, id: number) {
    if (id !== run.current || !voice.current) return;
    if (i >= lines.current.length) {
      utterance.current = null;
      setState('done');
      setIndex(-1);
      return;
    }
    at.current = i;
    const u = new SpeechSynthesisUtterance(lines.current[i]);
    u.voice = voice.current;
    u.lang = voice.current.lang;
    u.rate = RATE;
    u.onstart = () => {
      if (id === run.current) setIndex(i);
    };
    u.onend = () => say(i + 1, id);
    u.onerror = () => {
      // Zelf gestopt (pauze, nieuw antwoord)? Dan telt deze beurt al niet meer. Anders lukte het
      // voorlezen niet, bijvoorbeeld omdat de browser eerst een klik wil ('not-allowed'). Dan
      // staat er "Luisteren", en die klik start het opnieuw.
      if (id !== run.current) return;
      run.current++;
      utterance.current = null;
      setState('idle');
      setIndex(-1);
    };
    utterance.current = u;
    window.speechSynthesis.speak(u);
  }

  function play(sentences: string[], from = 0) {
    if (!voice.current) return;
    const id = ++run.current;
    window.speechSynthesis.cancel();
    lines.current = sentences;
    setState('speaking');
    setIndex(from);
    say(from, id);
  }

  function pause() {
    if (state !== 'speaking') return;
    run.current++;
    window.speechSynthesis.cancel();
    utterance.current = null;
    setState('paused');
    setIndex(at.current);
  }

  function resume() {
    if (state === 'paused') play(lines.current, at.current);
  }

  function stop() {
    run.current++;
    if (voice.current) window.speechSynthesis.cancel();
    utterance.current = null;
    lines.current = [];
    setState('idle');
    setIndex(-1);
  }

  // iOS laat een pagina pas praten na een tik. Een stille, lege uiting tijdens de klik op "Start
  // nieuws" geeft die toestemming, zodat het antwoord daarna vanzelf voorgelezen kan worden.
  function unlock() {
    if (!voice.current) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }

  return { available, state, index, play, pause, resume, stop, unlock };
}
