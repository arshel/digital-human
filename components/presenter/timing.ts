import type { TimingEvent, TimingStep } from './types.ts';

// Metingen per cyclus: één klik (Start, een knop, een vraag, volgend bericht) tot Nova hoorbaar
// praat. Eén cyclus tegelijk. Een event met een ander cyclusnummer hoort bij een oude cyclus en
// telt niet; verbindingsevents (zonder nummer) horen bij de lopende cyclus. Tijden in ms na de
// klik. Alleen getallen en korte codes, geen tekst: zie app/api/timing.

export type CacheState = 'ready' | 'pending' | 'miss' | 'none';
export type Attempt = { provider: string; model: string; ms: number; result: string };
export type ServerTiming = { requestId?: string; cache?: CacheState; articleMs?: number; generateMs?: number; attempts?: Attempt[] };

type Step = TimingStep | 'text';

export type TimingReport = {
  cycle: number;
  action: string;
  steps: Partial<Record<Step, number>>;
  stream?: string;
  video?: string; // resolutie van het live beeld toen Nova begon te praten
  closed: string[];
  replaced: boolean;
  server?: ServerTiming;
};

type Current = Omit<TimingReport, 'replaced'> & { start: number };

export class CycleTiming {
  private current: Current | null = null;

  // Nieuwe cyclus. Liep er nog een (nooit hoorbaar geworden), dan komt die terug als `replaced`.
  start(cycle: number, action: string, at: number): TimingReport | null {
    const previous = this.flush(true);
    this.current = { cycle, action, start: at, steps: {}, closed: [] };
    return previous;
  }

  // Het antwoord van de server is binnen.
  text(cycle: number, at: number, server: ServerTiming) {
    const c = this.current;
    if (!c || c.cycle !== cycle) return;
    c.steps.text ??= at - c.start;
    c.server = server;
  }

  // Geeft 'done' als de cyclus compleet is (Nova is hoorbaar).
  event(e: TimingEvent): 'done' | null {
    const c = this.current;
    if (!c) return null;
    if (e.cycle !== undefined && e.cycle !== c.cycle) return null;
    if (e.step === 'closed') {
      c.closed.push(e.detail ?? '?');
      return null;
    }
    if (e.step === 'connected' && e.detail) c.stream = e.detail;
    if (e.step === 'playing' && e.detail) c.video ??= e.detail;
    c.steps[e.step] ??= e.at - c.start;
    return e.step === 'audio' ? 'done' : null;
  }

  // Afsluiten. Met `cycle`: alleen als dat nog de lopende cyclus is.
  flush(replaced = false, cycle?: number): TimingReport | null {
    const c = this.current;
    if (!c || (cycle !== undefined && c.cycle !== cycle)) return null;
    this.current = null;
    const { start: _start, ...report } = c;
    return { ...report, replaced };
  }
}
