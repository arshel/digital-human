import type { AgentManager } from '@d-id/client-sdk';
import { sentenceAt, type PauseKind, type Presenter, type PresenterEvents, type Timing, type TimingStep } from './types.ts';

// De echte presentator: een D-ID-agent via de officiële Agents SDK (@d-id/client-sdk).
// Gecontroleerd in de SDK-typen (3.0.x) en docs.d-id.com, oktober 2026:
// - ChatMode.DirectPlayback: alleen speak(), geen chat en geen LLM van D-ID. De tekst komt dus
//   uit Gemini via onze server. Alleen voor Talks (V2) en Clips (V3) agents.
// - speak({ type: 'text', input, provider }) laat de agent precies onze tekst zeggen, met een
//   Microsoft-stem. Het antwoord geeft de videoduur (`duration`) en een `videoId`.
// - Timing: alleen begin en eind van het spreken (onVideoStateChange, en op een fluent stream
//   onAgentActivityStateChange). Geen timing per zin of woord. `duration` kwam bij onze Talks-agent
//   als 0 terug. Audiopauzes en geschatte spreektijd bepalen daarom de zinsgrenzen.
//   Dit is een benadering: RMS herkent geen woorden, komma's of echte zinsgrenzen.
//   SSML-pauzes zijn optioneel: onze Talks-agent las die soms hardop voor.
// - Pauzeren bestaat niet. interrupt() stopt het spreken, maar alleen op een fluent stream
//   (Clips op een Pro-avatar, of Expressive). Daarna verder = de rest opnieuw laten uitspreken.
//   Zonder fluent stream kan alleen het geluid uit; het fragment loopt bij D-ID door.
// - Geen emoties of gezichtsuitdrukkingen: `sentiment` werkt alleen bij Expressive (V4), en die
//   kan niet in DirectPlayback.
// - Analytics van de SDK (Mixpanel) staat standaard aan; wij zetten het uit.
// - Verbinding sluiten: disconnect(). D-ID sluit zelf af na inactiviteit (sessionTimeout).
// - SDK 3.0.6, nagelezen in de typen en de broncode: interrupt() doet alleen iets op een fluent
//   stream én terwijl er een video speelt; een verstuurde speak() die nog niet speelt is er niet
//   mee te stoppen, en speak() zelf is niet af te breken. manager.disconnect() annuleert wel een
//   connect() die nog loopt.

type Sdk = typeof import('@d-id/client-sdk');
type Session = {
  agentId: string;
  clientKey: string;
  voice: { id: string; rate: string };
  localReplay: boolean;
  sentenceBreaks: boolean;
};

// Geluidsniveau (RMS) van de stream, voor de timing per zin.
export type Meter = { level: () => number; close: () => void };

export type DidDeps = {
  loadSdk: () => Promise<Sdk>;
  fetch: typeof fetch;
  // Verbruik naar de server; sendBeacon werkt ook als de pagina sluit.
  report: (body: { kind: 'spoken' | 'connected'; seconds: number; videoId?: string }) => void;
  now: () => number;
  meter: (stream: MediaStream) => Meter | null;
  staleTimeoutMs?: number; // alleen voor tests
};

// Timing per zin uit het geluid. Twee metingen samen:
// - hoe lang de stem al spreekt (alleen tijd met geluid), tegenover de lengte van de zin in tekens;
// - een stilte rond het verwachte einde van de zin.
// Een stilte vroeg in een zin (een komma) telt niet; blijft een duidelijke stilte uit, dan schuift
// de zin toch door als de spreektijd ruim voorbij de verwachting is. Het tempo (tekens per seconde
// spreektijd) stelt zich bij op elk gemeten zinseinde.
const BREAK_MS = 400;
const LISTEN_MS = 40;
const START_CPS = 14; // Nederlandse Microsoft-stem op tempo 1, alleen spreektijd (zonder pauzes)
const MIN_GAP_MS = 180; // kortste stilte die een zinseinde kan zijn
const EARLY = 0.6; // een stilte vóór 60% van de verwachte spreektijd is een komma, geen zinseinde
const LATE = 1.4; // zonder stilte toch door na 140% van de verwachte spreektijd

function escapeXml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Eén AudioContext, gemaakt tijdens de klik op Start: Safari laat een context die later (na het
// verbinden) wordt gemaakt stil staan, en dan meet de ondertiteling niets.
let sharedAudio: AudioContext | null = null;

function primeAudio() {
  if (sharedAudio || typeof AudioContext === 'undefined') return;
  try {
    sharedAudio = new AudioContext();
    sharedAudio.resume().catch(() => {});
  } catch {
    sharedAudio = null;
  }
}

function audioMeter(stream: MediaStream): Meter | null {
  if (!stream.getAudioTracks().length || typeof AudioContext === 'undefined') return null;
  try {
    primeAudio();
    const context = sharedAudio ?? new AudioContext();
    context.resume().catch(() => {});
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    // Alleen meten, niet naar de luidsprekers: het geluid loopt al via het video-element.
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    return {
      level: () => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += v * v;
        return Math.sqrt(sum / samples.length);
      },
      close: () => {
        if (context !== sharedAudio) context.close().catch(() => {});
      },
    };
  } catch (err) {
    console.error('[d-id] geluid meten lukt niet; meeleestekst zonder markering:', err);
    return null;
  }
}

const defaultDeps = (): DidDeps => ({
  loadSdk: () => import('@d-id/client-sdk'),
  fetch: (...args) => fetch(...args),
  report: (body) => {
    const data = JSON.stringify(body);
    if (!navigator.sendBeacon?.('/api/did/usage', data)) {
      fetch('/api/did/usage', { method: 'POST', body: data, keepalive: true }).catch(() => {});
    }
  },
  now: () => performance.now(),
  meter: audioMeter,
});

// Fluent: zo lang wachten we op het begin of einde van een gestopt fragment. Komt dat niet, dan
// de verbinding sluiten; dat stopt het zeker.
const STALE_TIMEOUT_MS = 8000;

const MESSAGES: Record<number, string> = {
  402: 'Het testtegoed voor de avatar is op.',
  409: 'De echte avatar staat uit.',
  429: 'Te veel pogingen achter elkaar. Wacht even.',
};

export class DidPresenter implements Presenter {
  private video: HTMLVideoElement;
  private events: PresenterEvents;
  private deps: DidDeps;
  private manager: AgentManager | null = null;
  private session: Session | null = null;
  private connecting: Promise<boolean> | null = null;
  // Aangemaakt, maar connect() loopt nog: nog niet bruikbaar. Pas na een geslaagde connect()
  // wordt hij this.manager. Zo betekent "er is een manager" nooit "er is een verbinding".
  private building: AgentManager | null = null;
  private connectedAt: number | null = null;
  private closing = false;
  private stream: MediaStream | null = null;
  private idleVideo: string | null = null;
  private legacy = false;

  // Het fragment dat nu (of het laatst) klinkt.
  private lines: string[] = [];
  private from = 0;
  private generation = 0; // elk nieuw fragment of stop verhoogt dit; late events tellen niet
  private talking = false;
  private startedAt = 0;
  private expected = 0; // seconden volgens D-ID
  private position = 0; // zin waar verder moet na een pauze
  private paused = false;
  private muted = false; // pauze zonder interrupt: geluid uit, D-ID speelt door
  private connection = 0; // elke verbinding een nummer; events van een gesloten verbinding tellen niet
  // Een speak() die bij D-ID is aangevraagd maar nog niet speelt (de generation ervan). interrupt()
  // kan die niet stoppen, dus stoppen gaat dan anders; zie stopTalking().
  private requested: number | null = null;
  // Fluent: een oud fragment dat bij D-ID nog moet beginnen ('start') of na interrupt() nog moet
  // eindigen ('stop'). Zolang dat zo is, staat het geluid uit en gaat er geen nieuw fragment de
  // deur uit. Zo hoort elke START daarna bij het nieuwe fragment, en kan een laat event van het
  // oude het nieuwe niet onderbreken of stil laten.
  private stale: { phase: 'start' | 'stop'; generation: number; settled: Promise<void>; done: () => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private cycle: number | undefined; // meetnummer van het huidige fragment (alleen voor metingen)

  // Lokale herhaling: het laatst volledig gesproken fragment, opgenomen in het geheugen, met de
  // gemeten begintijd van elke zin (ms na het begin), zodat de ondertiteling ook dan meeloopt.
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private recording: { key: string; url: string; marks: number[] } | null = null;
  private replaying = false;

  // Timing per zin uit het geluid.
  private meter: Meter | null = null;
  private sentence = -1;
  private marks: number[] = [];
  private listener: ReturnType<typeof setInterval> | null = null;
  private silentSince: number | null = null;
  private heard = false;
  private peak = 0;
  private spokenMs = 0; // spreektijd (met geluid) sinds het begin van dit fragment
  private sentenceStartMs = 0; // spreektijd waarop de huidige zin begon
  private cps = START_CPS;
  private ssmlFailed = false;

  // Geen parameter property (private x in de constructor): node --test kan die niet lezen.
  private idleElement: HTMLVideoElement | null;

  constructor(video: HTMLVideoElement, events: PresenterEvents, deps: DidDeps = defaultDeps(), idleElement: HTMLVideoElement | null = null) {
    this.idleElement = idleElement;
    this.video = video;
    this.events = events;
    this.deps = deps;
  }

  get canResume() {
    return this.paused;
  }

  get timing(): Timing {
    return this.meter || (this.replaying && this.recording?.marks.length) ? 'estimated' : 'none';
  }

  get pauseKind(): PauseKind {
    return this.manager?.isInterruptAvailable() ? 'stop' : 'mute';
  }

  connect(): Promise<boolean> {
    if (this.manager) return Promise.resolve(true);
    this.prime();
    // Dubbel klikken mag geen tweede (betaalde) sessie opleveren.
    if (!this.connecting) {
      const attempt: Promise<boolean> = this.open().finally(() => {
        if (this.connecting === attempt) this.connecting = null;
      });
      this.connecting = attempt;
    }
    return this.connecting;
  }

  // Tijdens de klik (connect() loopt synchroon vanuit de knop): het video-element en het geluid
  // vrijgeven. Anders blokkeert de browser het afspelen met geluid, omdat de stream pas seconden
  // later binnenkomt, en moet de gebruiker nog een keer klikken.
  private primed = false;
  private prime() {
    if (this.primed) return;
    this.primed = true;
    this.video.muted = false;
    this.video.play().catch(() => {});
    primeAudio();
  }

  // Na elke wachtstap: is deze poging intussen afgebroken (disconnect, verborgen tabblad), dan
  // ruimt open() zelf op en geeft false. Een verbinding die pas daarna klaarkomt, gaat meteen dicht.
  private async open(): Promise<boolean> {
    const conn = ++this.connection;
    const current = () => conn === this.connection;
    let manager: AgentManager | null = null;
    this.events.onState('connecting');
    this.mark('connect-start');
    try {
      const res = await this.deps.fetch('/api/did/session', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!current()) return false;
      if (!res.ok) throw new Error(MESSAGES[res.status] ?? 'De avatar kan nu niet starten.');
      this.session = data as Session;

      const sdk = await this.deps.loadSdk();
      if (!current()) return false;
      manager = await sdk.createAgentManager(this.session.agentId, {
        auth: { type: 'key', clientKey: this.session.clientKey },
        mode: sdk.ChatMode.DirectPlayback,
        analytics: { enabled: false },
        streamOptions: { fluent: true },
        callbacks: {
          onSrcObjectReady: (stream) => {
            if (!current()) return;
            if (stream !== this.stream) {
              this.meter?.close();
              this.meter = this.deps.meter(stream);
            }
            this.stream = stream;
            if (!this.replaying) {
              this.showStream();
              if (this.legacy && !this.talking) this.showIdle();
            }
          },
          // De SDK-enums zijn strings ('disconnected', 'START', 'TALKING'); zo vergelijken blijft los
          // van de enum-import, die pas na het laden van de SDK bestaat.
          onConnectionStateChange: (state, reason) => {
            if (!current()) return;
            if (['disconnected', 'closed', 'fail'].includes(String(state))) this.dropped(reason);
          },
          onVideoStateChange: (state) => {
            if (!current() || !this.legacy) return;
            if (String(state) === 'START') this.talkStart();
            else if (String(state) === 'STOP') this.talkStop();
          },
          onAgentActivityStateChange: (state) => {
            if (!current() || this.legacy) return;
            if (String(state) === 'TALKING') this.talkStart();
            else if (String(state) === 'IDLE') this.talkStop();
          },
          onError: (error) => console.error('[d-id]', error.message),
        },
      });
      if (!current()) return this.abandon(manager);
      this.building = manager;
      this.closing = false;
      await manager.connect();
      if (this.building === manager) this.building = null;
      if (!current()) return this.abandon(manager);
      this.manager = manager;
      this.connectedAt = this.deps.now();
      this.legacy = String(manager.getStreamType()) === 'legacy';
      this.idleVideo = manager.agent.idle_video ?? null;
      if (this.legacy) this.showIdle();
      this.mark('connected', { detail: String(manager.getStreamType()) });
      this.events.onState('ready');
      return true;
    } catch (err) {
      if (manager && this.building === manager) this.building = null;
      if (!current()) return manager ? this.abandon(manager) : false;
      console.error('[d-id] verbinden mislukt:', err);
      this.manager = null;
      this.events.onState('error', err instanceof Error && Object.values(MESSAGES).includes(err.message) ? err.message : 'Verbinding mislukt. Probeer opnieuw.');
      throw err;
    }
  }

  // Een verbinding van een afgebroken poging: dicht, en niet gebruiken.
  private abandon(manager: AgentManager) {
    manager.disconnect().catch(() => {});
    return false;
  }

  // Lopend verbinden afbreken: de poging wordt oud (open() ruimt zelf op) en de manager in opbouw
  // krijgt disconnect(), wat in SDK 3.0.6 een lopende connect() annuleert.
  private cancelConnecting() {
    if (!this.connecting) return false;
    this.connection++;
    this.connecting = null;
    const building = this.building;
    this.building = null;
    building?.disconnect().catch(() => {});
    return true;
  }

  private mark(step: TimingStep, extra: { cycle?: number; detail?: string } = {}) {
    this.events.onTiming?.({ step, at: this.deps.now(), ...extra });
  }

  private showStream() {
    if (!this.stream) return;
    if (this.idleElement) { this.idleElement.hidden = true; this.idleElement.pause(); }
    if (this.video.srcObject !== this.stream) {
      this.video.removeAttribute('src');
      this.video.srcObject = this.stream;
    }
    this.video.loop = false;
    this.video.muted = this.muted || this.stale !== null;
    this.video.play().catch(() => {});
  }

  // Keep the live WebRTC element attached. Replacing its source with an idle
  // file forces a new playback/buffering cycle at every sentence fragment.
  private showIdle() {
    const idle = this.idleElement;
    if (!this.idleVideo || !idle) return;
    if (idle.getAttribute('src') !== this.idleVideo) idle.src = this.idleVideo;
    idle.loop = true;
    idle.muted = true;
    idle.hidden = false;
    idle.play().catch(() => {});
  }

  async speak(sentences: string[], from = 0, cycle?: number) {
    this.stopTalking();
    // Na elke wachtstap: is er intussen een nieuwer fragment of een stop geweest, dan gaat dit
    // fragment niet meer naar D-ID.
    const generation = ++this.generation;
    const valid = () => generation === this.generation;
    let ready = await this.connect();
    if (!valid() || !ready) return;
    while (this.stale) {
      await this.stale.settled;
      if (!valid()) return;
      if (!this.manager) ready = await this.connect(); // de verbinding ging dicht (time-out)
      if (!valid() || !ready) return;
    }
    const manager = this.manager;
    if (!manager || !this.session) return;
    this.cycle = cycle;
    this.lines = sentences;
    this.from = from;
    this.position = from;
    this.expected = 0;
    this.paused = false;
    this.muted = false;
    this.video.muted = false;
    this.events.onState('loading');

    const rest = sentences.slice(from);
    const provider = {
      type: 'microsoft' as const,
      voice_id: this.session.voice.id,
      voice_config: { rate: this.session.voice.rate },
    };
    const withBreaks = this.session.sentenceBreaks && !this.ssmlFailed;
    this.requested = generation;
    this.mark('speak-sent', { cycle });
    try {
      const res = await manager
        .speak(
          withBreaks
            ? { type: 'text', ssml: true, input: rest.map(escapeXml).join(` <break time="${BREAK_MS}ms"/> `), provider }
            : { type: 'text', input: rest.join(' '), provider },
        )
        .catch((err) => {
          if (!withBreaks) throw err;
          // SSML geweigerd? Eén keer zonder pauzes; de timing per zin wordt dan minder betrouwbaar.
          console.error('[d-id] speak met SSML mislukt, opnieuw zonder:', err);
          this.ssmlFailed = true;
          return manager.speak({ type: 'text', input: rest.join(' '), provider });
        });
      // Gemeten door D-ID: de duur van de video die voor dit fragment is gemaakt.
      if (res.duration > 0) this.deps.report({ kind: 'spoken', seconds: res.duration, videoId: res.videoId });
      if (!valid()) return;
      this.mark('speak-accepted', { cycle });
      this.expected = res.duration;
    } catch (err) {
      if (this.requested === generation) this.requested = null;
      // Gestopt fragment dat nooit gaat beginnen: niet blijven wachten.
      this.finishStale(generation);
      console.error('[d-id] speak mislukt:', err);
      if (valid()) this.events.onState('error', 'De avatar kan dit nu niet uitspreken. Probeer opnieuw.');
    }
  }

  private talkStart() {
    if (this.stale) {
      // Het gestopte fragment begint alsnog: meteen onderbreken, zonder geluid en zonder melding.
      if (this.stale.phase === 'start') {
        this.stale.phase = 'stop';
        this.manager?.interrupt({ type: 'click' });
      }
      return;
    }
    if (this.talking || this.replaying) return;
    if (this.requested === this.generation) this.requested = null;
    this.talking = true;
    this.startedAt = this.deps.now();
    if (this.legacy) this.showStream();
    this.startRecording();
    this.startListening();
    this.mark('playing', { cycle: this.cycle });
    if (!this.paused) this.events.onState('speaking');
  }

  private startListening() {
    this.stopListening();
    this.sentence = this.from;
    this.marks = [0];
    this.silentSince = null;
    this.heard = false;
    this.peak = 0;
    this.spokenMs = 0;
    this.sentenceStartMs = 0;
    this.events.onSentence(this.sentence);
    const meter = this.meter;
    if (!meter) return;
    let last = this.deps.now();
    this.listener = setInterval(() => {
      const now = this.deps.now();
      const step = Math.max(0, now - last);
      last = now;
      const level = meter.level();
      this.peak = Math.max(this.peak * 0.995, level);
      const silent = level < Math.max(0.004, this.peak * 0.12);
      if (silent) {
        if (this.heard && this.silentSince === null) this.silentSince = now;
      } else {
        this.spokenMs += step;
        if (!this.heard) this.mark('audio', { cycle: this.cycle });
        this.heard = true;
      }
      if (!this.heard) return;
      if (this.sentence >= this.lines.length - 1) return;

      const expected = (this.lines[this.sentence].length / this.cps) * 1000;
      const progress = (this.spokenMs - this.sentenceStartMs) / expected;
      const pausedLongEnough = this.silentSince !== null && now - this.silentSince >= MIN_GAP_MS;
      // Een zinseinde bij een stilte, zodra de stem daarna weer begint; of te laat zonder stilte.
      if (!silent && ((pausedLongEnough && progress >= EARLY) || progress >= LATE)) {
        if (pausedLongEnough) {
          // Gemeten zinseinde: tempo bijstellen (rustig, zodat één uitschieter weinig doet).
          const measured = this.lines[this.sentence].length / ((this.spokenMs - this.sentenceStartMs) / 1000);
          this.cps = Math.min(22, Math.max(9, this.cps * 0.7 + measured * 0.3));
        }
        this.sentence++;
        this.sentenceStartMs = this.spokenMs;
        this.marks.push(now - this.startedAt);
        if (!this.paused) this.events.onSentence(this.sentence);
      }
      if (!silent) this.silentSince = null;
    }, LISTEN_MS);
  }

  private stopListening() {
    if (this.listener) clearInterval(this.listener);
    this.listener = null;
  }

  private talkStop() {
    if (this.stale) {
      if (this.stale.phase === 'stop') this.finishStale();
      return;
    }
    if (!this.talking) return;
    this.talking = false;
    this.stopListening();
    this.events.onSentence(-1);
    this.finishRecording(!this.paused && this.from === 0);
    if (this.legacy) this.showIdle();
    if (this.muted) {
      // Gepauzeerd zonder interrupt: het fragment is bij D-ID afgelopen; verder = de rest opnieuw.
      this.muted = false;
      return;
    }
    if (!this.paused) this.events.onState('ready');
  }

  // Het lopende fragment beëindigen zonder state-melding (nieuw fragment, volgend bericht).
  private stopTalking() {
    this.generation++;
    if (this.replaying) this.endReplay();
    const requested = this.requested;
    this.requested = null;
    const talking = this.talking;
    if (!talking && requested === null) return;
    if (talking) {
      this.stopListening();
      this.events.onSentence(-1);
      this.finishRecording(false);
      this.talking = false;
    }
    if (this.manager?.isInterruptAvailable()) {
      // Speelt het al, dan nu onderbreken; anders wachten tot het begint (interrupt() kan dan nog niets).
      if (talking) this.manager.interrupt({ type: 'click' });
      this.expectStale(talking ? 'stop' : 'start', requested ?? -1);
    } else {
      // Kan niet onderbreken (Talks-agent). Een nieuw fragment speelt D-ID direct na het oude af,
      // zonder stopsignaal ertussen, dus het antwoord zou stil blijven. Daarom de verbinding
      // sluiten: dat stopt het oude fragment echt. Het volgende speak() verbindt opnieuw; bij een
      // vraag gebeurt dat terwijl het taalmodel het antwoord schrijft. Ook nodig voor een fragment
      // dat nog niet speelt: dat zou anders alsnog beginnen.
      this.close(talking ? 'stop' : 'stop-before-start');
    }
  }

  private expectStale(phase: 'start' | 'stop', generation: number) {
    if (this.stale) return;
    let done!: () => void;
    const settled = new Promise<void>((resolve) => (done = resolve));
    const timer = setTimeout(() => {
      if (this.stale?.settled === settled) this.close('stale-timeout');
    }, this.deps.staleTimeoutMs ?? STALE_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
    this.stale = { phase, generation, settled, done, timer };
    this.video.muted = true;
  }

  // Zonder argument: het oude fragment is klaar (of de verbinding is weg). Met een generation:
  // alleen als het wachten om precies dat fragment ging.
  private finishStale(generation?: number) {
    const stale = this.stale;
    if (!stale || (generation !== undefined && stale.generation !== generation)) return;
    clearTimeout(stale.timer);
    this.stale = null;
    this.video.muted = this.muted;
    stale.done();
  }

  // Verbinding dicht zonder state-melding: de volgende connect() maakt een nieuwe.
  private close(reason: string) {
    const manager = this.manager;
    if (!manager) return;
    this.manager = null;
    this.connection++;
    this.requested = null;
    this.mark('closed', { detail: reason });
    this.reportConnected();
    this.meter?.close();
    this.meter = null;
    this.stream = null;
    this.video.srcObject = null;
    this.muted = false;
    this.finishStale();
    this.video.muted = false;
    this.showIdle();
    manager.disconnect().catch(() => {});
  }

  pause() {
    if (this.replaying) {
      this.video.pause();
      this.paused = true;
      this.events.onState('paused');
      return;
    }
    if (!this.talking || this.paused) return;
    this.position = this.currentSentence();
    this.paused = true;
    if (this.manager?.isInterruptAvailable()) {
      this.stopListening();
      this.finishRecording(false);
      this.talking = false;
      this.generation++;
      this.manager.interrupt({ type: 'click' });
      this.expectStale('stop', -1);
    } else {
      // D-ID speelt door (Talks kan niet onderbreken). Dan in beeld in elk geval geen pratend
      // gezicht: de rustige idle-video, of anders het beeld stilzetten.
      this.muted = true;
      this.video.muted = true;
      if (this.legacy && this.idleVideo && this.idleElement) this.showIdle();
      else this.video.pause();
    }
    this.events.onState('paused');
  }

  async resume() {
    if (!this.paused) return;
    if (this.replaying) {
      this.paused = false;
      await this.video.play().catch(() => {});
      this.events.onState('speaking');
      return;
    }
    if (this.muted && this.talking) {
      // Het fragment liep nog: beeld en geluid weer aan. Wat tijdens de pauze is gezegd, is gemist.
      this.paused = false;
      this.muted = false;
      this.showStream();
      this.video.muted = false;
      this.video.play().catch(() => {});
      this.events.onSentence(this.sentence);
      this.events.onState('speaking');
      return;
    }
    // Opnieuw laten uitspreken vanaf de zin waar het ongeveer was (geschat).
    await this.speak(this.lines, this.position);
  }

  async replay() {
    if (!this.lines.length) return;
    const key = this.lines.join(' ');
    if (this.session?.localReplay && this.recording?.key === key) {
      // Uit het geheugen van de browser: D-ID maakt geen nieuwe video.
      this.stopTalking();
      this.replaying = true;
      this.paused = false;
      this.video.srcObject = null;
      this.video.loop = false;
      this.video.src = this.recording.url;
      this.video.muted = false;
      this.video.onended = () => {
        this.endReplay();
        this.events.onState('ready');
      };
      this.events.onState('speaking');
      // De ondertiteling volgt de tijden die bij de opname zijn gemeten.
      const marks = this.recording.marks;
      let shown = -1;
      this.stopListening();
      this.listener = setInterval(() => {
        const at = this.video.currentTime * 1000;
        const index = marks.filter((m) => m <= at).length - 1;
        if (index !== shown) this.events.onSentence((shown = index));
      }, LISTEN_MS * 2);
      await this.video.play().catch(() => {});
      return;
    }
    await this.speak(this.lines, 0);
  }

  private endReplay() {
    this.replaying = false;
    this.stopListening();
    this.events.onSentence(-1);
    this.video.onended = null;
    if (this.legacy) this.showIdle();
    else this.showStream();
  }

  stop() {
    const was = (this.talking || this.replaying || this.paused || this.requested !== null) && this.manager !== null;
    this.stopTalking();
    this.paused = false;
    this.muted = false;
    if (was) this.events.onState('ready');
  }

  async disconnect(reason = '') {
    const wasConnecting = this.cancelConnecting();
    // Eerst de verbinding overnemen: dan sluit stopTalking() niet zelf, en meldt dit de status.
    const manager = this.manager;
    this.manager = null;
    this.stopTalking();
    this.requested = null;
    this.finishStale();
    this.paused = false;
    if (!manager) {
      if (wasConnecting) {
        this.mark('closed', { detail: reason || 'leave' });
        this.events.onState(reason ? 'disconnected' : 'idle', reason);
      }
      return;
    }
    this.connection++;
    this.closing = true;
    this.mark('closed', { detail: reason || 'leave' });
    this.reportConnected();
    this.meter?.close();
    this.meter = null;
    this.stream = null;
    this.video.srcObject = null;
    this.idleElement?.pause();
    if (this.idleElement) this.idleElement.hidden = true;
    await manager.disconnect().catch(() => {});
    this.events.onState(reason ? 'disconnected' : 'idle', reason);
  }

  // D-ID of het netwerk sloot de verbinding (inactiviteit, tijdslimiet, netwerk).
  private dropped(reason?: string) {
    if (this.closing || !this.manager) return;
    const wasTalking = this.talking;
    if (wasTalking) {
      this.position = this.currentSentence();
      this.paused = true;
    }
    this.stopListening();
    this.talking = false;
    this.requested = null;
    this.manager = null;
    this.finishStale();
    this.mark('closed', { detail: `dropped${reason ? `:${reason}` : ''}` });
    this.reportConnected();
    this.events.onState('disconnected', reason === 'inactivity' ? 'idle' : 'dropped');
  }

  // Zin waar verder moet: gemeten als dat kan, anders geschat uit de verstreken tijd.
  private currentSentence() {
    if (this.meter) return Math.max(this.from, this.sentence);
    const elapsed = (this.deps.now() - this.startedAt) / 1000;
    return sentenceAt(this.lines, this.from, this.expected ? elapsed / this.expected : 0);
  }

  private reportConnected() {
    if (this.connectedAt === null) return;
    this.deps.report({ kind: 'connected', seconds: (this.deps.now() - this.connectedAt) / 1000 });
    this.connectedAt = null;
  }

  private startRecording() {
    if (!this.session?.localReplay || !this.stream || this.from !== 0 || typeof MediaRecorder === 'undefined') return;
    try {
      this.chunks = [];
      const recorder = new MediaRecorder(this.stream);
      recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
      recorder.start();
      this.recorder = recorder;
    } catch (err) {
      console.error('[d-id] opnemen voor herhalen lukt niet:', err);
      this.recorder = null;
    }
  }

  // Alleen een volledig gesproken fragment bewaren: een half fragment herhalen klopt niet.
  private finishRecording(complete: boolean) {
    const recorder = this.recorder;
    this.recorder = null;
    if (!recorder || recorder.state === 'inactive') return;
    const key = this.lines.join(' ');
    const marks = [...this.marks];
    recorder.onstop = () => {
      if (!complete || !this.chunks.length) return;
      if (this.recording) URL.revokeObjectURL(this.recording.url);
      this.recording = { key, marks, url: URL.createObjectURL(new Blob(this.chunks, { type: recorder.mimeType })) };
    };
    recorder.stop();
  }
}
