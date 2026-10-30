import type { AnamClient, MessageStreamEvent } from '@anam-ai/js-sdk';
import type { PauseKind, Presenter, PresenterEvents, Timing, TimingStep } from './types.ts';

// Proef: dezelfde Nova op Anam (@anam-ai/js-sdk 4.29). Nagelezen in de typen van de SDK en
// anam.ai/docs, oktober 2026:
// - Het token komt van onze server (/api/anam/session); de persona heeft geen eigen taalmodel
//   (CUSTOMER_CLIENT_V1). Nova zegt alleen wat wij sturen.
// - Een fragment gaat als talk-stream met een eigen correlationId. De SDK geeft die alleen terug
//   in de transcriptgebeurtenissen (MESSAGE_STREAM_EVENT_RECEIVED, rol 'persona'), en dan verpakt:
//   live gezien als `external::<onze id>::<eigen achtervoegsel>`. Komt er geen id mee, dan hoort
//   het eerste nieuwe Anam-bericht (message id) na het versturen bij dit fragment. Berichten van
//   gestopte fragmenten tellen nooit meer.
// - 'ready' pas bij het eerste echte beeld (VIDEO_PLAY_STARTED): anders staat er een leeg
//   video-element in beeld terwijl Anam nog opstart.
// - Begin en einde van het spreken: het eerste transcriptstuk van het fragment, en endOfSpeech of
//   interrupted. De zin in beeld volgt hoeveel van de tekst Anam al heeft uitgesproken.
// - interruptPersona() stopt meteen. Pauze is dus echt; verder spreekt de rest opnieuw uit.
// - Geen microfoon (disableInputAudio): de gebruiker praat niet met Nova.

type Sdk = typeof import('@anam-ai/js-sdk');

export type AnamDeps = {
  loadSdk: () => Promise<Sdk>;
  fetch: typeof fetch;
  now: () => number;
  // Tijdelijk, alleen ontwikkelserver: de vorm van elk transcriptevent (geen tekst) naar de serverlog.
  debug?: (info: Record<string, unknown>) => void;
};

const defaultDeps = (): AnamDeps => ({
  loadSdk: () => import('@anam-ai/js-sdk'),
  fetch: (...args) => fetch(...args),
  now: () => performance.now(),
  debug: (info) => {
    fetch('/api/anam/debug', { method: 'POST', body: JSON.stringify(info), keepalive: true }).catch(() => {});
  },
});

const VIDEO_ID = 'nova-video';
const FIRST_FRAME_MS = 5000;

export class AnamPresenter implements Presenter {
  readonly pauseKind: PauseKind = 'stop';
  private video: HTMLVideoElement;
  private events: PresenterEvents;
  private deps: AnamDeps;
  private client: AnamClient | null = null; // verbonden en bruikbaar
  private building: AnamClient | null = null; // aangemaakt, verbinden loopt nog
  private connecting: Promise<boolean> | null = null;
  private connection = 0;

  private lines: string[] = [];
  private from = 0;
  private position = 0; // zin waar verder moet na een pauze
  private generation = 0;
  private fragment: string | null = null; // correlationId van het fragment dat nu mag klinken
  private message: string | null = null; // Anam-bericht (message id) dat bij dit fragment hoort
  private stale = new Set<string>(); // Anam-berichten van gestopte fragmenten
  private requested = false; // verstuurd, nog niet hoorbaar
  private talking = false;
  private paused = false;
  private spoken = ''; // wat Anam van dit fragment al heeft uitgesproken
  private sentence = -1;
  private cycle: number | undefined;

  constructor(video: HTMLVideoElement, events: PresenterEvents, deps: AnamDeps = defaultDeps()) {
    this.video = video;
    this.events = events;
    this.deps = deps;
  }

  get canResume() {
    return this.paused;
  }

  // De zin volgt het transcript van Anam. Hoe goed dat met de stem samenvalt, moet de proef laten zien.
  get timing(): Timing {
    return 'estimated';
  }

  connect(): Promise<boolean> {
    if (this.client) return Promise.resolve(true);
    if (!this.connecting) {
      const attempt: Promise<boolean> = this.open().finally(() => {
        if (this.connecting === attempt) this.connecting = null;
      });
      this.connecting = attempt;
    }
    return this.connecting;
  }

  private async open(): Promise<boolean> {
    const conn = ++this.connection;
    const current = () => conn === this.connection;
    let client: AnamClient | null = null;
    this.events.onState('connecting');
    this.mark('connect-start');
    try {
      const res = await this.deps.fetch('/api/anam/session', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!current()) return false;
      if (!res.ok || !data?.sessionToken) throw new Error(data?.error ?? 'De avatar kan nu niet starten.');

      const sdk = await this.deps.loadSdk();
      if (!current()) return false;
      client = sdk.createClient(data.sessionToken, { disableInputAudio: true });
      client.addListener(sdk.AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (e: MessageStreamEvent) => {
        if (current()) this.transcript(e);
      });
      client.addListener(sdk.AnamEvent.CONNECTION_CLOSED, (reason: unknown) => {
        if (current()) this.dropped(String(reason));
      });
      let firstFrame!: () => void;
      const playing = new Promise<void>((resolve) => (firstFrame = resolve));
      client.addListener(sdk.AnamEvent.VIDEO_PLAY_STARTED, () => firstFrame());
      this.building = client;
      this.video.id ||= VIDEO_ID;
      await client.streamToVideoElement(this.video.id);
      // Wachten op het eerste echte beeld, maar nooit eindeloos.
      await Promise.race([playing, new Promise((resolve) => setTimeout(resolve, FIRST_FRAME_MS))]);
      if (this.building === client) this.building = null;
      if (!current()) return this.abandon(client);
      this.client = client;
      this.mark('connected', { detail: 'anam' });
      this.events.onState('ready');
      return true;
    } catch (err) {
      if (client && this.building === client) this.building = null;
      if (!current()) return client ? this.abandon(client) : false;
      console.error('[anam] verbinden mislukt:', err);
      this.client = null;
      this.events.onState('error', err instanceof Error && err.message.startsWith('De ') ? err.message : 'Verbinding mislukt. Probeer opnieuw.');
      throw err;
    }
  }

  private abandon(client: AnamClient) {
    client.stopStreaming().catch(() => {});
    return false;
  }

  private mark(step: TimingStep, extra: { cycle?: number; detail?: string } = {}) {
    this.events.onTiming?.({ step, at: this.deps.now(), ...extra });
  }

  async speak(sentences: string[], from = 0, cycle?: number) {
    this.stopTalking();
    const generation = ++this.generation;
    const valid = () => generation === this.generation;
    const ready = await this.connect();
    if (!valid() || !ready || !this.client) return;
    const client = this.client;
    const fragment = crypto.randomUUID();
    this.fragment = fragment;
    this.message = null;
    this.cycle = cycle;
    this.lines = sentences;
    this.from = from;
    this.position = from;
    this.paused = false;
    this.spoken = '';
    this.requested = true;
    this.events.onState('loading');
    this.mark('speak-sent', { cycle });
    try {
      const stream = client.createTalkMessageStream(fragment);
      await stream.streamMessageChunk(sentences.slice(from).join(' '), true);
      if (valid()) this.mark('speak-accepted', { cycle });
    } catch (err) {
      console.error('[anam] spreken mislukt:', err);
      if (valid()) {
        this.requested = false;
        this.events.onState('error', 'De avatar kan dit nu niet uitspreken. Probeer opnieuw.');
      }
    }
  }

  // Wat Anam uitspreekt, stukje voor stukje. Alleen van het fragment dat nu mag klinken.
  private transcript(e: MessageStreamEvent) {
    this.deps.debug?.({ role: e.role, id: e.id, cid: e.correlationId ?? null, mine: this.fragment, end: e.endOfSpeech, int: e.interrupted, len: e.content.length });
    if (e.role !== 'persona' || !this.fragment || this.stale.has(e.id)) return;
    if (e.correlationId !== undefined) {
      if (!e.correlationId.split('::').includes(this.fragment)) return;
    } else if (this.message === null ? e.interrupted : e.id !== this.message) {
      // Zonder id: een onderbroken bericht kan nooit het begin van dit fragment zijn.
      return;
    }
    this.message = e.id;
    if (!this.talking && !e.interrupted) this.talkStart();
    // Sommige versies sturen het hele transcript tot nu toe, andere alleen het nieuwe stuk.
    this.spoken = this.spoken && e.content.startsWith(this.spoken) ? e.content : this.spoken + e.content;
    this.follow();
    if (e.endOfSpeech || e.interrupted) this.talkStop();
  }

  private talkStart() {
    this.talking = true;
    this.requested = false;
    this.sentence = -1;
    this.mark('playing', { cycle: this.cycle });
    // Anam meldt geen apart "geluid hoorbaar"; het eerste transcriptstuk valt daarmee samen.
    this.mark('audio', { cycle: this.cycle });
    this.follow();
    if (!this.paused) this.events.onState('speaking');
  }

  // Welke zin klinkt nu: hoeveel tekens van het fragment al zijn uitgesproken.
  private follow() {
    if (!this.talking) return;
    const said = this.spoken.replace(/\s+/g, ' ').trim().length;
    let total = 0;
    let index = this.from;
    for (let i = this.from; i < this.lines.length; i++) {
      total += this.lines[i].length + 1;
      index = i;
      if (total > said) break;
    }
    if (index !== this.sentence) {
      this.sentence = index;
      this.events.onSentence(index);
    }
  }

  private talkStop() {
    this.talking = false;
    this.fragment = null;
    this.message = null;
    this.events.onSentence(-1);
    if (!this.paused) this.events.onState('ready');
  }

  // Het lopende fragment beëindigen zonder statusmelding. Zonder fragment-id tellen late
  // transcriptgebeurtenissen van het oude niet meer.
  private stopTalking() {
    this.generation++;
    const active = this.talking || this.requested;
    if (this.message) this.stale.add(this.message);
    this.message = null;
    this.fragment = null;
    this.talking = false;
    this.requested = false;
    if (!active) return;
    this.events.onSentence(-1);
    try {
      this.client?.interruptPersona();
    } catch (err) {
      console.error('[anam] onderbreken mislukt:', err);
    }
  }

  pause() {
    if (!this.talking || this.paused) return;
    this.position = Math.max(this.from, this.sentence);
    this.paused = true;
    this.stopTalking();
    this.events.onState('paused');
  }

  async resume() {
    if (!this.paused) return;
    await this.speak(this.lines, this.position);
  }

  // Anam opnieuw laten uitspreken: geen opname nodig, en goedkoop genoeg.
  async replay() {
    if (!this.lines.length) return;
    await this.speak(this.lines, 0);
  }

  stop() {
    const was = (this.talking || this.requested || this.paused) && this.client !== null;
    this.stopTalking();
    this.paused = false;
    if (was) this.events.onState('ready');
  }

  async disconnect(reason = '') {
    const wasConnecting = this.connecting !== null;
    this.connection++;
    this.connecting = null;
    const building = this.building;
    this.building = null;
    building?.stopStreaming().catch(() => {});
    const client = this.client;
    this.client = null;
    this.stopTalking();
    this.paused = false;
    if (!client && !wasConnecting) return;
    this.mark('closed', { detail: reason || 'leave' });
    await client?.stopStreaming().catch(() => {});
    this.events.onState(reason ? 'disconnected' : 'idle', reason);
  }

  // Anam of het netwerk sloot de verbinding.
  private dropped(reason: string) {
    if (!this.client) return;
    if (this.talking) {
      this.position = Math.max(this.from, this.sentence);
      this.paused = true;
    }
    this.client = null;
    this.talking = false;
    this.requested = false;
    this.fragment = null;
    this.message = null;
    this.mark('closed', { detail: `dropped:${reason}` });
    this.events.onState('disconnected', 'dropped');
  }
}
