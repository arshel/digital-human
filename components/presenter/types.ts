// Eén bediening voor twee presentatoren: de gesimuleerde (ontwikkelmodus, geen Anam) en de echte
// Anam-stream. De pagina weet niet welke het is; ze weet alleen wat de presentator nu doet.

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
// - sentence: de zin volgt wat er werkelijk is uitgesproken (browserstem, Anam-transcript);
// - simulated: gesimuleerd tempo per zin (ontwikkelmodus zonder stem), dus niet echt gelijk;
// - none: geen timing per zin, dus meeleestekst.
export type Timing = 'sentence' | 'simulated' | 'none';


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
  // Luisteren (alleen Anam): microfoon aan of uit, geweigerd, en de vraag zoals verstaan.
  onListening?: (state: ListenState) => void;
  onHeard?: (text: string) => void;
};

export type ListenState = 'on' | 'off' | 'denied' | 'failed';

export interface Presenter {
  readonly timing: Timing;
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
  // Optioneel: een gesproken vraag. De microfoon staat alleen aan tussen listen() en het einde
  // van de vraag (of stopListening()). Daarna volgt onHeard met de tekst.
  readonly canListen?: boolean;
  listen?(): Promise<void>;
  stopListening?(): void;
}

// Mag de inactiviteitstimer lopen? Nooit tijdens genereren (busy), verbinden of spreken: alleen
// als Nova echt stilstaat. Ook in pauze: een vergeten pauze moet de verbinding toch sluiten.
export function idleTimerRuns(state: PresenterState, busy: boolean) {
  return !busy && (state === 'ready' || state === 'paused' || state === 'error');
}

