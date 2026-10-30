import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { DidPresenter, type DidDeps } from '../components/presenter/did.ts';
import type { TimingEvent } from '../components/presenter/types.ts';

// De D-ID-presentator met een nagemaakte SDK: geen netwerk, geen betaalde stream. Getest wordt
// het gedrag dat geld of verwarring kan kosten: dubbele sessies, oude fragmenten die doorlopen,
// pauzeren en herhalen. De SDK-nabootsing volgt 3.0.6: START komt pas als D-ID de video heeft
// gemaakt, interrupt() werkt alleen op een spelende video, en disconnect() annuleert een
// connect() die nog loopt.

type Callbacks = Record<string, (...args: unknown[]) => void>;

function setup({ interruptible = true, sessionStatus = 200, sentenceBreaks = false, rejectSsml = false } = {}) {
  const calls = { session: 0, create: 0, connect: 0, speak: [] as { input: string; ssml?: boolean }[], interrupt: 0, disconnect: 0 };
  const sound = { level: 0 };
  const reports: { kind: string; seconds: number }[] = [];
  const states: string[] = [];
  const sentences: number[] = [];
  let callbacks: Callbacks = {};
  const older: Callbacks[] = [];
  let createOptions: Record<string, unknown> = {};
  let clock = 0;
  const timings: TimingEvent[] = [];
  // Een stap in de SDK vasthouden tot de test hem loslaat.
  const gates: Record<'create' | 'connect', Promise<void> | null> = { create: null, connect: null };
  const hold = (step: 'create' | 'connect') => {
    let release!: () => void;
    gates[step] = new Promise<void>((r) => (release = r));
    return () => {
      gates[step] = null;
      release();
    };
  };

  const manager = {
    agent: { idle_video: null },
    connect: async () => {
      calls.connect++;
      if (gates.connect) await gates.connect;
    },
    speak: async (payload: { input: string; ssml?: boolean }) => {
      calls.speak.push(payload);
      if (rejectSsml && payload.ssml) throw new Error('400 ssml');
      return { status: 'ok', duration: 10, videoId: `v${calls.speak.length}` };
    },
    interrupt: () => {
      calls.interrupt++;
    },
    isInterruptAvailable: () => interruptible,
    getStreamType: () => (interruptible ? 'fluent' : 'legacy'),
    disconnect: async () => {
      calls.disconnect++;
    },
  };

  const deps: DidDeps = {
    fetch: (async () => {
      calls.session++;
      return new Response(
        JSON.stringify({ agentId: 'agt_test', clientKey: 'ck', voice: { id: 'nl-NL-FennaNeural', rate: '1' }, localReplay: true, sentenceBreaks }),
        { status: sessionStatus },
      );
    }) as typeof fetch,
    loadSdk: async () =>
      ({
        ChatMode: { DirectPlayback: 'DirectPlayback' },
        createAgentManager: async (_id: string, options: { callbacks: Callbacks }) => {
          calls.create++;
          older.push(callbacks);
          callbacks = options.callbacks;
          createOptions = options;
          await new Promise((r) => setTimeout(r, 5));
          if (gates.create) await gates.create;
          return manager;
        },
      }) as never,
    report: (body) => reports.push(body),
    now: () => clock,
    meter: () => ({ level: () => sound.level, close: () => {} }),
    staleTimeoutMs: 30,
  };

  const video = {
    muted: false,
    loop: false,
    srcObject: null as unknown,
    src: '',
    paused: false,
    async play() {
      this.paused = false;
    },
    pause() {
      this.paused = true;
    },
    removeAttribute: () => {},
  };

  const presenter = new DidPresenter(video as unknown as HTMLVideoElement, { onState: (s) => states.push(s), onSentence: (i) => sentences.push(i), onTiming: (e) => timings.push(e) }, deps);
  return {
    presenter,
    calls,
    reports,
    states,
    sentences,
    sound,
    timings,
    hold,
    video,
    fire: (name: string, value: unknown) => callbacks[name](value),
    fireOld: (name: string, value: unknown) => older.at(-1)?.[name]?.(value),
    tick: (ms: number) => (clock += ms),
    options: () => createOptions,
  };
}

const LINES = ['Eerste zin hier.', 'Tweede zin hier.', 'Derde zin hier.', 'Vierde zin hier.'];
const settle = (ms = 15) => new Promise((r) => setTimeout(r, ms));

describe('DidPresenter', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('maakt bij snel dubbelklikken maar één sessie', async () => {
    await Promise.all([t.presenter.connect(), t.presenter.connect(), t.presenter.connect()]);
    await t.presenter.connect();
    assert.equal(t.calls.session, 1);
    assert.equal(t.calls.create, 1);
    assert.equal(t.calls.connect, 1);
  });

  it('gebruikt DirectPlayback (geen LLM van D-ID) en zet analytics uit', async () => {
    await t.presenter.connect();
    assert.equal(t.options().mode, 'DirectPlayback');
    assert.deepEqual(t.options().analytics, { enabled: false });
  });

  it('spreekt precies onze tekst uit en meldt de duur die D-ID teruggeeft', async () => {
    await t.presenter.speak(LINES);
    assert.equal(t.calls.speak.length, 1);
    assert.equal(t.calls.speak[0].input, LINES.join(' '));
    assert.deepEqual(t.reports, [{ kind: 'spoken', seconds: 10, videoId: 'v1' }]);
  });

  it('pauze onderbreekt echt, en verder spreekt alleen de rest', async () => {
    await t.presenter.speak(LINES);
    t.fire('onAgentActivityStateChange', 'TALKING');
    t.tick(6000); // 6 van de 10 seconden: ongeveer bij zin 3
    t.presenter.pause();
    assert.equal(t.calls.interrupt, 1);
    assert.equal(t.states.at(-1), 'paused');
    t.fire('onAgentActivityStateChange', 'IDLE'); // D-ID: onderbroken
    await t.presenter.resume();
    assert.equal(t.calls.speak.length, 2);
    assert.equal(t.calls.speak[1].input, LINES.slice(2).join(' '));
  });

  it('volgend bericht onderbreekt het lopende fragment', async () => {
    await t.presenter.speak(LINES);
    t.fire('onAgentActivityStateChange', 'TALKING');
    t.presenter.stop();
    assert.equal(t.calls.interrupt, 1);
    assert.equal(t.states.at(-1), 'ready');
  });

  it('zonder fluent stream: pauze zet het geluid uit en een oud fragment wordt genegeerd', async () => {
    t = setup({ interruptible: false });
    await t.presenter.speak(LINES);
    t.fire('onVideoStateChange', 'START');
    t.presenter.pause();
    assert.equal(t.calls.interrupt, 0);
    assert.equal(t.video.muted, true);
    assert.equal(t.video.paused, true, 'geen pratend gezicht tijdens de pauze');
    await t.presenter.resume();
    assert.equal(t.video.muted, false);
    assert.equal(t.video.paused, false);
    assert.equal(t.calls.speak.length, 1, 'het fragment liep nog: geen nieuwe speak');

    // Vraag of nieuw bericht terwijl het oude nog loopt: D-ID zou het nieuwe er direct achter
    // plakken, zonder stopsignaal, en dan bleef het antwoord stil. Dus: verbinding dicht (stopt
    // het oude echt) en een nieuwe voor het antwoord.
    await t.presenter.speak(['Nieuw bericht.']);
    assert.equal(t.calls.disconnect, 1, 'oude fragment gestopt door de verbinding te sluiten');
    assert.equal(t.calls.create, 2, 'nieuwe verbinding voor het antwoord');
    assert.equal(t.calls.speak.at(-1)?.input, 'Nieuw bericht.');
    assert.equal(t.video.muted, false, 'het antwoord is te horen');
    t.fireOld('onConnectionStateChange', 'disconnected'); // late melding van de oude verbinding
    t.fireOld('onVideoStateChange', 'STOP');
    t.fire('onVideoStateChange', 'START');
    assert.equal(t.states.at(-1), 'speaking');
    t.fire('onVideoStateChange', 'STOP');
    assert.equal(t.states.at(-1), 'ready');
  });

  it('zonder fluent stream: volgend bericht stopt het oude fragment echt', async () => {
    t = setup({ interruptible: false });
    await t.presenter.speak(LINES);
    t.fire('onVideoStateChange', 'START');
    t.presenter.stop();
    assert.equal(t.calls.disconnect, 1);
    assert.equal(t.states.at(-1), 'ready');
    assert.equal(t.reports.at(-1)?.kind, 'connected', 'verbindingstijd telt mee in het verbruik');
  });

  it('nog een keer zonder opname vraagt hetzelfde fragment opnieuw', async () => {
    await t.presenter.speak(LINES);
    t.fire('onAgentActivityStateChange', 'TALKING');
    t.fire('onAgentActivityStateChange', 'IDLE');
    await t.presenter.replay();
    assert.equal(t.calls.speak[1].input, LINES.join(' '));
  });

  it('meldt een op tegoed in gewone taal', async () => {
    t = setup({ sessionStatus: 402 });
    await assert.rejects(t.presenter.connect());
    assert.equal(t.states.at(-1), 'error');
  });

  it('meldt bij afsluiten hoe lang de verbinding openstond (schatting)', async () => {
    await t.presenter.connect();
    t.tick(30_000);
    await t.presenter.disconnect();
    assert.equal(t.calls.disconnect, 1);
    assert.deepEqual(t.reports.at(-1), { kind: 'connected', seconds: 30 });
  });

  it('verbroken verbinding midden in een uitleg: verder gaat verder waar het was', async () => {
    await t.presenter.speak(LINES);
    t.fire('onAgentActivityStateChange', 'TALKING');
    t.tick(1000);
    t.fire('onConnectionStateChange', 'disconnected');
    assert.equal(t.states.at(-1), 'disconnected');
    assert.equal(t.presenter.canResume, true);
    await t.presenter.resume();
    assert.equal(t.calls.create, 2, 'opnieuw verbonden');
    assert.equal(t.calls.speak.at(-1)?.input, LINES.join(' '));
  });

  it('stuurt een SSML-pauze na elke zin, met ontsnapte tekens', async () => {
    t = setup({ sentenceBreaks: true });
    await t.presenter.speak(['Jan & Piet <zeggen> iets.', 'Tweede zin.']);
    assert.equal(t.calls.speak[0].ssml, true);
    assert.equal(t.calls.speak[0].input, 'Jan &amp; Piet &lt;zeggen&gt; iets. <break time="400ms"/> Tweede zin.');
  });

  it('probeert het zonder SSML als D-ID dat weigert', async () => {
    t = setup({ sentenceBreaks: true, rejectSsml: true });
    await t.presenter.speak(LINES);
    assert.equal(t.calls.speak.length, 2);
    assert.equal(t.calls.speak[1].ssml, undefined);
    assert.equal(t.calls.speak[1].input, LINES.join(' '));
    assert.notEqual(t.states.at(-1), 'error');
  });

  it('ondertiteling: komma telt niet, zinseinde wel, en zonder pauze schuift hij toch door', async (ctx) => {
    // Zinnen van 56 tekens: bij 14 tekens per seconde ongeveer 4 seconden spreektijd.
    const long = [
      'Twee Kamerleden willen de verkeersboetes anders regelen.',
      'Gevaarlijk rijden moet duurder worden, kleine fouten niet.',
      'Het is een voorstel en nog geen besluit van de regering.',
    ];
    await t.presenter.connect();
    t.fire('onSrcObjectReady', {});
    assert.equal(t.presenter.timing, 'estimated');
    await t.presenter.speak(long);
    ctx.mock.timers.enable({ apis: ['setInterval'] });
    t.fire('onAgentActivityStateChange', 'TALKING');
    const run = (level: number, ms: number) => {
      t.sound.level = level;
      for (let i = 0; i < ms; i += 40) {
        t.tick(40);
        ctx.mock.timers.tick(40);
      }
    };
    run(0.2, 1500);
    run(0, 250); // komma, vroeg in de zin
    run(0.2, 1500);
    assert.deepEqual(t.sentences.filter(i => i >= 0), [0], 'komma schuift niet door');
    run(0.2, 1000); // ruim 4 s spreektijd
    run(0, 350); // pauze na de zin
    run(0.2, 400);
    assert.deepEqual(t.sentences.filter(i => i >= 0), [0, 1], 'zinseinde bij de stilte');
    run(0.2, 7000); // geen duidelijke pauze: toch door na ruim de verwachte tijd
    assert.deepEqual(t.sentences.filter(i => i >= 0), [0, 1, 2]);
    t.presenter.pause(); // verder gaat bij de gemeten zin, niet bij een schatting
    t.fire('onAgentActivityStateChange', 'IDLE');
    await t.presenter.resume();
    assert.equal(t.calls.speak.at(-1)?.input, long[2]);
  });
  it('bij dempen blijft de zichtbare zin staan; hervatten volgt de doorgelopen stream', async (ctx) => {
    t = setup({ interruptible: false });
    await t.presenter.connect(); t.fire('onSrcObjectReady', {});
    await t.presenter.speak(LINES);
    ctx.mock.timers.enable({ apis: ['setInterval'] });
    t.fire('onVideoStateChange', 'START');
    t.sound.level = .2; t.tick(40); ctx.mock.timers.tick(40);
    t.presenter.pause();
    const shown = [...t.sentences];
    for (let i = 0; i < 100; i++) { t.tick(40); ctx.mock.timers.tick(40); }
    assert.deepEqual(t.sentences, shown, 'stilgezette ondertiteling verandert niet');
    await t.presenter.resume();
    assert.ok(t.sentences.at(-1)! > 0, 'na hervatten weer bij de actuele zin');
    assert.equal(t.calls.speak.length, 1, 'geen extra betaalde aanvraag');
    await t.presenter.disconnect();
  });


  // ---------- gestopt maar nog niet gestart ----------

  it('legacy: gestopt vóór START, dan kan het oude fragment nooit meer beginnen', async () => {
    t = setup({ interruptible: false });
    await t.presenter.speak(LINES, 0, 1); // verstuurd; D-ID maakt de video nog
    t.presenter.stop(); // volgend bericht, voordat Nova begint
    assert.equal(t.calls.disconnect, 1, 'verbinding dicht: alleen zo stopt een Talks-fragment');
    assert.equal(t.states.at(-1), 'ready');
    t.fire('onVideoStateChange', 'START'); // het oude fragment begint alsnog, op de gesloten verbinding
    assert.notEqual(t.states.at(-1), 'speaking');
    assert.deepEqual(t.timings.filter((e) => e.step === 'closed').map((e) => e.detail), ['stop-before-start']);
  });

  it('legacy: nieuw antwoord vóór START van het oude: alleen het nieuwe klinkt', async () => {
    t = setup({ interruptible: false });
    await t.presenter.speak(['Oud antwoord.'], 0, 1);
    await t.presenter.speak(['Nieuw antwoord.'], 0, 2);
    assert.equal(t.calls.disconnect, 1);
    assert.equal(t.calls.create, 2, 'het nieuwe antwoord op een nieuwe verbinding');
    t.fireOld('onVideoStateChange', 'START'); // laat: het oude fragment op de oude verbinding
    assert.notEqual(t.states.at(-1), 'speaking');
    t.fire('onVideoStateChange', 'START');
    assert.equal(t.states.at(-1), 'speaking');
    assert.equal(t.video.muted, false);
    assert.deepEqual(t.timings.filter((e) => e.step === 'playing').map((e) => e.cycle), [2]);
  });

  it('fluent: gestopt vóór START wordt onderbroken zodra het begint; het nieuwe gaat pas daarna weg', async () => {
    await t.presenter.speak(['Oud antwoord.'], 0, 1);
    const next = t.presenter.speak(['Nieuw antwoord.'], 0, 2);
    await settle();
    assert.equal(t.calls.speak.length, 1, 'het nieuwe wacht tot het oude is afgehandeld');
    assert.equal(t.calls.interrupt, 0, 'interrupt() kan nog niets: het oude speelt nog niet');
    assert.equal(t.video.muted, true, 'het oude is niet te horen als het toch begint');
    t.fire('onAgentActivityStateChange', 'TALKING'); // het oude begint alsnog
    assert.equal(t.calls.interrupt, 1);
    assert.notEqual(t.states.at(-1), 'speaking');
    t.fire('onAgentActivityStateChange', 'IDLE'); // en is gestopt
    await next;
    assert.deepEqual(t.calls.speak.map((s) => s.input), ['Oud antwoord.', 'Nieuw antwoord.']);
    assert.equal(t.video.muted, false, 'het nieuwe antwoord is te horen');
    t.fire('onAgentActivityStateChange', 'TALKING');
    assert.equal(t.states.at(-1), 'speaking');
    assert.equal(t.calls.interrupt, 1, 'het nieuwe antwoord wordt niet onderbroken');
    assert.equal(t.calls.disconnect, 0, 'geen nieuwe verbinding nodig');
    assert.deepEqual(t.timings.filter((e) => e.step === 'playing').map((e) => e.cycle), [2]);
  });

  it('fluent: begint het gestopte fragment nooit, dan na een time-out dicht en een nieuwe verbinding', async () => {
    await t.presenter.speak(['Oud antwoord.'], 0, 1);
    await t.presenter.speak(['Nieuw antwoord.'], 0, 2); // time-out (30 ms in de test), dan verder
    assert.equal(t.calls.disconnect, 1);
    assert.equal(t.calls.create, 2);
    assert.equal(t.calls.speak.at(-1)?.input, 'Nieuw antwoord.');
    assert.equal(t.video.muted, false);
    assert.ok(t.timings.some((e) => e.step === 'closed' && e.detail === 'stale-timeout'));
  });

  it('fluent: een late IDLE van een onderbroken fragment laat het nieuwe niet stil', async () => {
    await t.presenter.speak(['Oud antwoord.'], 0, 1);
    t.fire('onAgentActivityStateChange', 'TALKING');
    const next = t.presenter.speak(['Nieuw antwoord.'], 0, 2); // onderbreekt het oude
    assert.equal(t.calls.interrupt, 1);
    await settle();
    assert.equal(t.calls.speak.length, 1, 'wacht op het einde van het oude');
    t.fire('onAgentActivityStateChange', 'IDLE');
    await next;
    assert.equal(t.video.muted, false);
    t.fire('onAgentActivityStateChange', 'TALKING');
    assert.equal(t.states.at(-1), 'speaking');
    assert.equal(t.calls.interrupt, 1);
  });

  // ---------- verbinden en annuleren ----------

  it('artikelwissel tijdens verbinden: alleen het nieuwste fragment gaat naar D-ID', async () => {
    const a = t.presenter.speak(['Oud bericht.'], 0, 1);
    const b = t.presenter.speak(['Nieuw bericht.'], 0, 2);
    await Promise.all([a, b]);
    assert.equal(t.calls.create, 1);
    assert.deepEqual(t.calls.speak.map((s) => s.input), ['Nieuw bericht.']);
  });

  it('afsluiten tijdens connect(): de SDK annuleert, en een verbinding die toch klaarkomt gaat dicht', async () => {
    const release = t.hold('connect');
    const connecting = t.presenter.connect();
    await settle();
    assert.equal(t.calls.connect, 1, 'connect() loopt');
    await t.presenter.disconnect('hidden');
    assert.equal(t.calls.disconnect, 1, 'disconnect() op de manager in opbouw (annuleert in SDK 3.0.6)');
    assert.equal(t.states.at(-1), 'disconnected');
    release();
    assert.equal(await connecting, false, 'geen bruikbare verbinding');
    assert.equal(t.calls.disconnect, 2, 'klaargekomen na annuleren: alsnog dicht');
    assert.ok(!t.states.slice(t.states.indexOf('disconnected')).includes('ready'));
    // De volgende klik verbindt gewoon opnieuw.
    await t.presenter.speak(['Weer verder.']);
    assert.equal(t.calls.create, 2);
    assert.equal(t.calls.speak.at(-1)?.input, 'Weer verder.');
  });

  it('afsluiten terwijl de manager nog wordt aangemaakt: connect() wordt nooit aangeroepen', async () => {
    const release = t.hold('create');
    const connecting = t.presenter.connect();
    await settle();
    await t.presenter.disconnect('idle');
    release();
    assert.equal(await connecting, false);
    assert.equal(t.calls.connect, 0);
    assert.equal(t.calls.disconnect, 1, 'de manager die daarna nog kwam, is dichtgedaan');
  });

  it('een manager in opbouw telt niet als verbonden', async () => {
    const release = t.hold('connect');
    const connecting = t.presenter.connect();
    await settle();
    const again = t.presenter.connect(); // tweede klik tijdens het verbinden
    assert.equal(t.calls.create, 1, 'geen tweede sessie');
    release();
    assert.deepEqual(await Promise.all([connecting, again]), [true, true]);
    assert.equal(t.states.at(-1), 'ready');
  });

  // ---------- pauze en metingen ----------

  it('legacy-pauze: D-ID speelt op de achtergrond door tot het fragment klaar is', async () => {
    t = setup({ interruptible: false });
    await t.presenter.speak(LINES);
    t.fire('onVideoStateChange', 'START');
    t.presenter.pause();
    assert.equal(t.presenter.pauseKind, 'mute', 'geen echte pauze bij deze agent');
    assert.equal(t.calls.interrupt, 0);
    assert.equal(t.calls.disconnect, 0, 'pauze sluit niet');
    t.fire('onVideoStateChange', 'STOP'); // D-ID is op de achtergrond klaar
    assert.equal(t.states.at(-1), 'paused');
    await t.presenter.resume();
    assert.equal(t.calls.speak.length, 2, 'verder = de rest opnieuw uitspreken');
  });

  it('metingen: verbinden, versturen, geaccepteerd en beeld, met het juiste cyclusnummer', async () => {
    await t.presenter.speak(LINES, 0, 7);
    t.fire('onAgentActivityStateChange', 'TALKING');
    assert.deepEqual(
      t.timings.map((e) => [e.step, e.cycle ?? null, e.detail ?? null]),
      [
        ['connect-start', null, null],
        ['connected', null, 'fluent'],
        ['speak-sent', 7, null],
        ['speak-accepted', 7, null],
        ['playing', 7, null],
      ],
    );
  });
});
