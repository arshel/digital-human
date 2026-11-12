import type { AnamClient, MessageStreamEvent } from '@anam-ai/js-sdk';
import type { Presenter, PresenterEvents, Timing, TimingStep } from './types.ts';

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
// - Luisteren: de SDK krijgt een eigen, stille geluidsstroom (streamToVideoElement(id, stroom)) en
//   vraagt dan zelf nooit om de microfoon. Pas als de gebruiker op de microfoonknop drukt, vragen
//   wij toestemming en sluiten we de microfoon op die stroom aan, tot Anam het einde van de vraag
//   meldt (transcript met rol 'user' en endOfSpeech). Daarna gaat de microfoon weer helemaal uit.
//   Anam maakt van de stem tekst (spraakherkenning, Nederlands); het antwoord maakt onze server.

type Sdk = typeof import('@anam-ai/js-sdk');

export type AnamDeps = {
  loadSdk: () => Promise<Sdk>;
  fetch: typeof fetch;
  now: () => number;
  // Tijdelijk, alleen ontwikkelserver: de vorm van elk transcriptevent (geen tekst) naar de serverlog.
  debug?: (info: Record<string, unknown>) => void;
  audio: () => OutgoingAudio;
  microphone: () => Promise<MediaStream>;
};

// Het geluid dat naar Anam gaat: stil, behalve als de microfoon is aangesloten.
export type OutgoingAudio = { stream: MediaStream; attach: (mic: MediaStream) => void; detach: () => void; close: () => void };

function outgoingAudio(): OutgoingAudio {
  const context = new AudioContext();
  context.resume().catch(() => {});
  const destination = context.createMediaStreamDestination();
  let source: MediaStreamAudioSourceNode | null = null;
  return {
    stream: destination.stream,
    attach(mic) {
      source?.disconnect();
      source = context.createMediaStreamSource(mic);
      source.connect(destination);
    },
    detach() {
      source?.disconnect();
      source = null;
    },
    close() {
      source?.disconnect();
      context.close().catch(() => {});
    },
  };
}

// Foutcodes van de Anam-SDK (ClientError.code) die de gebruiker iets zeggen. De rest wordt
// "Verbinding mislukt". De code zelf gaat naar de serverlog (alleen ontwikkelserver).
const CONNECT_MESSAGES: Record<string, string> = {
  CLIENT_ERROR_CODE_USAGE_LIMIT_REACHED: 'De minuten bij Anam zijn op. Nova kan nu niet live praten.',
  CLIENT_ERROR_CODE_NO_PLAN_FOUND: 'De minuten bij Anam zijn op. Nova kan nu niet live praten.',
  CLIENT_ERROR_CODE_SPEND_CAP_REACHED: 'De uitgavelimiet bij Anam is bereikt. Nova kan nu niet live praten.',
  CLIENT_ERROR_CODE_MAX_CONCURRENT_SESSIONS_REACHED: 'Nova praat al in een ander tabblad. Sluit dat en probeer opnieuw.',
  CLIENT_ERROR_CODE_SERVICE_BUSY: 'De avatar is nu druk. Probeer het zo opnieuw.',
};

function errorCode(err: unknown): string | null {
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : null;
  return typeof code === 'string' ? code.slice(0, 60) : null;
}

function errorStatus(err: unknown): number | null {
  const status = err && typeof err === 'object' ? (err as { statusCode?: unknown }).statusCode : null;
  return typeof status === 'number' ? status : null;
}

export function connectMessage(err: unknown): string {
  const known = CONNECT_MESSAGES[errorCode(err) ?? ''];
  if (known) return known;
  return err instanceof Error && err.message.startsWith('De ') ? err.message : 'Verbinding mislukt. Probeer opnieuw.';
}

const defaultDeps = (): AnamDeps => ({
  loadSdk: () => import('@anam-ai/js-sdk'),
  fetch: (...args) => fetch(...args),
  now: () => performance.now(),
  debug: (info) => {
    fetch('/api/anam/debug', { method: 'POST', body: JSON.stringify(info), keepalive: true }).catch(() => {});
  },
  audio: outgoingAudio,
  microphone: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
});

// Zo lang mag één vraag duren; daarna gaat de microfoon uit met wat er tot dan is verstaan.
const LISTEN_MAX_MS = 20000;

const VIDEO_ID = 'nova-video';
const FIRST_FRAME_MS = 5000;

export class AnamPresenter implements Presenter {
  readonly canListen = true;
  private video: HTMLVideoElement;
  // De greenscreenversie van Nova vragen (lib/greenscreen.ts): alleen als de pagina die vrijstaand
  // kan tonen (WebGL werkt). De server beslist of die er is; anders de gewone avatar.
  greenscreen = false;
  // Welke greenscreenvariant (lib/greenscreen.ts), of null voor de standaard.
  variant: string | null = null;
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
  private outgoing: OutgoingAudio | null = null;
  private mic: MediaStream | null = null;
  private listening = false;
  private heard = ''; // de vraag zoals Anam die tot nu toe verstond
  private listenTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(video: HTMLVideoElement, events: PresenterEvents, deps: AnamDeps = defaultDeps()) {
    this.video = video;
    this.events = events;
    this.deps = deps;
  }

  get canResume() {
    return this.paused;
  }

  // De zin volgt het transcript van Anam: wat er werkelijk is uitgesproken. In de live proef liep
  // dat goed gelijk met de stem.
  get timing(): Timing {
    return 'sentence';
  }

  connect(): Promise<boolean> {
    if (this.client) return Promise.resolve(true);
    // Tijdens de klik: een AudioContext die later wordt gemaakt, blijft op iOS stil.
    this.outgoing ??= this.deps.audio();
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
      const res = await this.deps.fetch('/api/anam/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ greenscreen: this.greenscreen, variant: this.variant }),
      });
      const data = await res.json().catch(() => null);
      if (!current()) return false;
      if (!res.ok || !data?.sessionToken) throw new Error(data?.error ?? 'De avatar kan nu niet starten.');

      const sdk = await this.deps.loadSdk();
      if (!current()) return false;
      client = sdk.createClient(data.sessionToken, { disableInputAudio: false });
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
      this.outgoing ??= this.deps.audio();
      await client.streamToVideoElement(this.video.id, this.outgoing.stream);
      // Wachten op het eerste echte beeld, maar nooit eindeloos.
      let frameTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([playing, new Promise((resolve) => (frameTimer = setTimeout(resolve, FIRST_FRAME_MS)))]);
      clearTimeout(frameTimer);
      if (this.building === client) this.building = null;
      if (!current()) return this.abandon(client);
      this.client = client;
      // Met de werkelijke resolutie van de stream: die kan lager zijn dan het wachtbeeld.
      this.mark('connected', { detail: `anam/${this.size()}` });
      this.events.onState('ready');
      return true;
    } catch (err) {
      if (client && this.building === client) this.building = null;
      if (!current()) return client ? this.abandon(client) : false;
      console.error('[anam] verbinden mislukt:', err);
      const code = errorCode(err);
      this.deps.debug?.({ role: 'verbinden-mislukt', error: code ?? 'onbekend', status: errorStatus(err) });
      this.client = null;
      this.events.onState('error', connectMessage(err));
      throw err;
    }
  }

  private size() {
    return `${this.video.videoWidth || 0}x${this.video.videoHeight || 0}`;
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
    if (e.role === 'user') return this.userSpeech(e);
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

  // ---------- luisteren ----------

  async listen() {
    if (this.listening) return;
    // Nova houdt op met praten als jij wilt praten.
    this.stop();
    const connecting = this.connect();
    let mic: MediaStream;
    try {
      mic = await this.deps.microphone();
    } catch (err) {
      const denied = err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      console.error('[anam] microfoon:', err);
      this.events.onListening?.(denied ? 'denied' : 'failed');
      return;
    }
    const ready = await connecting.catch(() => false);
    if (!ready || !this.outgoing) {
      mic.getTracks().forEach((t) => t.stop());
      this.events.onListening?.('failed');
      return;
    }
    this.mic = mic;
    this.outgoing.attach(mic);
    this.listening = true;
    this.heard = '';
    this.listenTimer = setTimeout(() => this.finishListening(true), LISTEN_MAX_MS);
    (this.listenTimer as { unref?: () => void }).unref?.();
    this.events.onListening?.('on');
  }

  stopListening() {
    this.finishListening(true);
  }

  // Microfoon helemaal uit (ook het lampje in de browser). Met `send`: wat verstaan is, gaat door.
  private finishListening(send: boolean) {
    if (!this.listening) return;
    this.listening = false;
    if (this.listenTimer) clearTimeout(this.listenTimer);
    this.listenTimer = null;
    this.outgoing?.detach();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.events.onListening?.('off');
    const text = this.heard.replace(/\s+/g, ' ').trim();
    this.heard = '';
    if (send && text) this.events.onHeard?.(text);
  }

  // Wat Anam van de gebruiker verstaat. Alleen terwijl wij luisteren.
  private userSpeech(e: MessageStreamEvent) {
    if (!this.listening) return;
    this.heard = this.heard && e.content.startsWith(this.heard) ? e.content : this.heard + e.content;
    if (e.endOfSpeech) this.finishListening(true);
  }

  private talkStart() {
    this.talking = true;
    this.requested = false;
    this.sentence = -1;
    this.mark('playing', { cycle: this.cycle, detail: this.size() });
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
    this.finishListening(false);
    this.stopTalking();
    this.paused = false;
    if (!client && !wasConnecting) return;
    this.mark('closed', { detail: reason || 'leave' });
    await client?.stopStreaming().catch(() => {});
    // Volgende verbinding: een nieuwe stroom, tijdens de volgende klik gemaakt.
    this.outgoing?.close();
    this.outgoing = null;
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
    this.finishListening(false);
    this.talking = false;
    this.requested = false;
    this.fragment = null;
    this.message = null;
    this.mark('closed', { detail: `dropped:${reason}` });
    this.events.onState('disconnected', 'dropped');
  }
}
