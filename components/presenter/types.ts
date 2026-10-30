// Eén bediening voor twee presentatoren: de gesimuleerde (ontwikkelmodus, geen D-ID) en de echte
// D-ID-stream. De pagina weet niet welke het is; ze weet alleen wat de presentator nu doet.

export type PresenterState =
  | 'idle' // nog niet verbonden
  | 'connecting'
  | 'ready' // verbonden, zegt niets
  | 'loading' // tekst verstuurd, wacht op het eerste beeld of geluid
  | 'speaking'
  | 'paused'
  | 'disconnected'
  | 'error';

// Hoe de ondertiteling met de stem samenhangt:
// - sentence: echte gebeurtenis per zin (browserstem);
// - estimated: audiopauzes met geschatte spreektijd (D-ID), geen exacte tijdcodes;
// - simulated: gesimuleerd tempo per zin (ontwikkelmodus zonder stem), dus niet echt gelijk;
// - none: geen timing per zin (D-ID meldt alleen begin en eind), dus meeleestekst.
export type Timing = 'sentence' | 'estimated' | 'simulated' | 'none';

// Wat "Pauze" echt doet:
// - stop: het spreken stopt echt (D-ID interrupt() op een fluent stream, of de browserstem);
// - mute: D-ID kan deze stream niet onderbreken; het geluid gaat uit, maar het fragment loopt bij
//   D-ID door tot het eind (en telt mee in het verbruik).
export type PauseKind = 'stop' | 'mute';

// Meetpunten voor de ontwikkelserver (app/api/timing). Verbindingsgebeurtenissen horen bij geen
// cyclus; fragmentgebeurtenissen dragen het cyclusnummer dat de pagina aan speak() meegaf, zodat
// een laat event van een oud fragment de meting van het nieuwe niet raakt. `at` komt van dezelfde
// klok als performance.now().
export type TimingStep = 'connect-start' | 'connected' | 'closed' | 'speak-sent' | 'speak-accepted' | 'playing' | 'audio';
export type TimingEvent = { step: TimingStep; at: number; cycle?: number; detail?: string };

export type PresenterEvents = {
  onState: (state: PresenterState, detail?: string) => void;
  onSentence: (index: number) => void;
  onTiming?: (event: TimingEvent) => void;
};

export interface Presenter {
  readonly timing: Timing;
  readonly pauseKind: PauseKind;
  // Er is een onderbroken fragment om mee verder te gaan (na Pauze of een verbroken verbinding).
  readonly canResume: boolean;
  // true als er een bruikbare verbinding is; false als het verbinden onderweg is afgebroken
  // (verborgen tabblad, afsluiten). Een fout gooit.
  connect(): Promise<boolean>;
  // Spreek deze zinnen uit, vanaf zin `from`. Een nieuw fragment stopt het vorige. `cycle` is
  // alleen voor de metingen.
  speak(sentences: string[], from?: number, cycle?: number): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  // Het laatste fragment nog een keer, vanaf het begin.
  replay(): Promise<void>;
  // Stoppen met spreken (volgend bericht), verbonden blijven.
  stop(): void;
  disconnect(reason?: string): Promise<void>;
}

// Mag de inactiviteitstimer lopen? Nooit tijdens genereren (busy), verbinden of spreken: alleen
// als Nova echt stilstaat. Ook in pauze: bij een Talks-agent speelt D-ID dan op de achtergrond
// door (zonder geluid), en een vergeten pauze moet de verbinding toch sluiten.
export function idleTimerRuns(state: PresenterState, busy: boolean) {
  return !busy && (state === 'ready' || state === 'paused' || state === 'error');
}

// Welke zin ongeveer klinkt na `fraction` van de spreektijd, gewogen naar het aantal tekens.
// Alleen een schatting: D-ID geeft geen timing per zin.
export function sentenceAt(sentences: string[], from: number, fraction: number) {
  const rest = sentences.slice(from);
  const total = rest.reduce((n, s) => n + s.length, 0);
  let passed = 0;
  for (let i = 0; i < rest.length; i++) {
    passed += rest[i].length;
    if (passed / total > fraction) return from + i;
  }
  return Math.max(from, sentences.length - 1);
}
