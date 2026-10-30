import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { AnamPresenter, type AnamDeps } from '../components/presenter/anam.ts';
import type { TimingEvent } from '../components/presenter/types.ts';

// De Anam-presentator met een nagemaakte SDK: geen netwerk, geen Anam-minuten. De nabootsing
// volgt @anam-ai/js-sdk 4.29: een talk-stream met correlationId, transcriptgebeurtenissen met
// die id terug, interruptPersona() en stopStreaming().

type Listener = (...args: unknown[]) => void;
type Chunk = { correlationId: string; text: string; end: boolean };

function setup({ sessionStatus = 200 } = {}) {
  const calls = { session: 0, create: 0, stream: 0, chunks: [] as Chunk[], interrupt: 0, stop: 0, options: [] as unknown[] };
  const states: string[] = [];
  const sentences: number[] = [];
  const timings: TimingEvent[] = [];
  const clients: { listeners: Record<string, Listener> }[] = [];
  let hold: Promise<void> | null = null;

  const deps: AnamDeps = {
    fetch: (async () => {
      calls.session++;
      return new Response(JSON.stringify(sessionStatus === 200 ? { sessionToken: 'tok' } : { error: 'De avatar kan nu niet starten.' }), { status: sessionStatus });
    }) as typeof fetch,
    loadSdk: async () =>
      ({
        AnamEvent: { MESSAGE_STREAM_EVENT_RECEIVED: 'MESSAGE_STREAM_EVENT_RECEIVED', CONNECTION_CLOSED: 'CONNECTION_CLOSED', VIDEO_PLAY_STARTED: 'VIDEO_PLAY_STARTED' },
        createClient: (_token: string, options: unknown) => {
          calls.create++;
          calls.options.push(options);
          const client = {
            listeners: {} as Record<string, Listener>,
            addListener(event: string, cb: Listener) {
              this.listeners[event] = cb;
            },
            async streamToVideoElement() {
              calls.stream++;
              await new Promise((r) => setTimeout(r, 5));
              if (hold) await hold;
              this.listeners.VIDEO_PLAY_STARTED?.(); // eerste beeld
            },
            createTalkMessageStream: (correlationId: string) => ({
              streamMessageChunk: async (text: string, end: boolean) => {
                calls.chunks.push({ correlationId, text, end });
              },
            }),
            interruptPersona: () => {
              calls.interrupt++;
            },
            stopStreaming: async () => {
              calls.stop++;
            },
          };
          clients.push(client);
          return client;
        },
      }) as never,
    now: () => 0,
    debug: () => {},
  };

  const video = { id: '' };
  const presenter = new AnamPresenter(video as unknown as HTMLVideoElement, { onState: (s) => states.push(s), onSentence: (i) => sentences.push(i), onTiming: (e) => timings.push(e) }, deps);
  // Anam vertelt wat de persona uitspreekt, met de correlationId van het fragment.
  const say = (content: string, extra: { endOfSpeech?: boolean; interrupted?: boolean; correlationId?: string; id?: string } = {}, client = clients.at(-1)) =>
    client?.listeners.MESSAGE_STREAM_EVENT_RECEIVED({
      id: 'persona::m',
      role: 'persona',
      content,
      endOfSpeech: false,
      interrupted: false,
      correlationId: calls.chunks.at(-1)?.correlationId,
      ...extra,
    });
  const holdConnect = () => {
    let release!: () => void;
    hold = new Promise<void>((r) => (release = r));
    return () => {
      hold = null;
      release();
    };
  };
  return { presenter, calls, states, sentences, timings, video, clients, say, holdConnect };
}

const LINES = ['Eerste zin hier.', 'Tweede zin hier.', 'Derde zin hier.'];
const settle = (ms = 15) => new Promise((r) => setTimeout(r, ms));

describe('AnamPresenter', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('maakt bij snel dubbelklikken maar één sessie, zonder microfoon', async () => {
    assert.deepEqual(await Promise.all([t.presenter.connect(), t.presenter.connect()]), [true, true]);
    await t.presenter.connect();
    assert.equal(t.calls.session, 1);
    assert.equal(t.calls.create, 1);
    assert.deepEqual(t.calls.options[0], { disableInputAudio: true });
    assert.equal(t.video.id, 'nova-video', 'het video-element krijgt een id voor de SDK');
  });

  it('spreekt precies onze tekst uit, als één talk-stream', async () => {
    await t.presenter.speak(LINES, 0, 1);
    assert.equal(t.calls.chunks.length, 1);
    assert.equal(t.calls.chunks[0].text, LINES.join(' '));
    assert.equal(t.calls.chunks[0].end, true);
    assert.equal(t.states.at(-1), 'loading');
    t.say('Eerste zin ');
    assert.equal(t.states.at(-1), 'speaking');
    t.say('hier. Tweede', { endOfSpeech: false });
    t.say(' zin hier. Derde zin hier.', { endOfSpeech: true });
    assert.equal(t.states.at(-1), 'ready');
  });

  it('de zin in beeld volgt wat Anam al heeft uitgesproken', async () => {
    await t.presenter.speak(LINES);
    t.say('Eerste zin');
    assert.equal(t.sentences.at(-1), 0);
    t.say(' hier. Tweede zin');
    assert.equal(t.sentences.at(-1), 1);
    t.say(' hier. Derde');
    assert.equal(t.sentences.at(-1), 2);
  });

  it('ook als Anam het hele transcript tot nu toe stuurt', async () => {
    await t.presenter.speak(LINES);
    t.say('Eerste zin hier.');
    t.say('Eerste zin hier. Tweede zin');
    assert.equal(t.sentences.at(-1), 1);
  });

  it('volgend bericht: oud fragment stopt, en een laat event ervan telt niet', async () => {
    await t.presenter.speak(['Oud bericht.'], 0, 1);
    const old = t.calls.chunks[0].correlationId;
    t.say('Oud');
    t.presenter.stop();
    assert.equal(t.calls.interrupt, 1);
    assert.equal(t.states.at(-1), 'ready');
    await t.presenter.speak(['Nieuw bericht.'], 0, 2);
    t.say(' bericht.', { correlationId: old }); // laat, van het oude fragment
    assert.equal(t.states.at(-1), 'loading', 'het nieuwe is nog niet begonnen');
    t.say('Nieuw', { id: 'persona::nieuw' }); // elk Anam-bericht heeft een eigen id
    assert.equal(t.states.at(-1), 'speaking');
    assert.deepEqual(t.timings.filter((e) => e.step === 'playing').map((e) => e.cycle), [1, 2]);
  });

  it('gestopt vóór het begint: wordt onderbroken en nooit hoorbaar gemeld', async () => {
    await t.presenter.speak(['Oud bericht.'], 0, 1);
    const old = t.calls.chunks[0].correlationId;
    t.presenter.stop();
    assert.equal(t.calls.interrupt, 1, 'ook een fragment dat nog niet klinkt, wordt onderbroken');
    t.say('Oud bericht.', { correlationId: old });
    assert.notEqual(t.states.at(-1), 'speaking');
  });

  it('pauze is echt, en verder spreekt de rest vanaf de huidige zin', async () => {
    await t.presenter.speak(LINES);
    t.say('Eerste zin hier. Tweede');
    t.presenter.pause();
    assert.equal(t.calls.interrupt, 1);
    assert.equal(t.states.at(-1), 'paused');
    assert.equal(t.presenter.canResume, true);
    t.say(' zin', { interrupted: true }); // laat, van het onderbroken fragment
    assert.equal(t.states.at(-1), 'paused');
    await t.presenter.resume();
    assert.equal(t.calls.chunks.at(-1)?.text, LINES.slice(1).join(' '));
  });

  it('nog een keer spreekt hetzelfde fragment opnieuw', async () => {
    await t.presenter.speak(LINES);
    t.say(LINES.join(' '), { endOfSpeech: true });
    await t.presenter.replay();
    assert.equal(t.calls.chunks.length, 2);
    assert.equal(t.calls.chunks[1].text, LINES.join(' '));
  });

  it('afsluiten tijdens verbinden: de sessie gaat dicht en wordt niet gebruikt', async () => {
    const release = t.holdConnect();
    const connecting = t.presenter.connect();
    await settle();
    await t.presenter.disconnect('hidden');
    assert.equal(t.calls.stop, 1, 'stopStreaming op de sessie in opbouw');
    assert.equal(t.states.at(-1), 'disconnected');
    release();
    assert.equal(await connecting, false);
    assert.ok(!t.states.slice(t.states.indexOf('disconnected')).includes('ready'));
    await t.presenter.speak(['Weer verder.']);
    assert.equal(t.calls.create, 2, 'de volgende klik verbindt opnieuw');
  });

  it('verbinding verbroken midden in een uitleg: verder gaat bij de juiste zin', async () => {
    await t.presenter.speak(LINES);
    t.say('Eerste zin hier. Tweede');
    t.clients.at(-1)?.listeners.CONNECTION_CLOSED('server');
    assert.equal(t.states.at(-1), 'disconnected');
    assert.equal(t.presenter.canResume, true);
    await t.presenter.resume();
    assert.equal(t.calls.create, 2);
    assert.equal(t.calls.chunks.at(-1)?.text, LINES.slice(1).join(' '));
  });

  it('meldt een mislukte start in gewone taal', async () => {
    t = setup({ sessionStatus: 502 });
    await assert.rejects(t.presenter.connect());
    assert.equal(t.states.at(-1), 'error');
  });

  // ---------- als Anam onze correlationId niet teruggeeft (zo bleek in de eerste live proef) ----------

  it('zonder correlationId: het eerste nieuwe bericht hoort bij het fragment', async () => {
    await t.presenter.speak(LINES, 0, 1);
    t.say('Eerste zin hier.', { correlationId: undefined, id: 'persona::1' });
    assert.equal(t.states.at(-1), 'speaking');
    assert.equal(t.sentences.at(-1), 0);
    t.say(' Tweede zin', { correlationId: undefined, id: 'persona::1' });
    assert.equal(t.sentences.at(-1), 1);
    t.say(' hier. Derde zin hier.', { correlationId: undefined, id: 'persona::1', endOfSpeech: true });
    assert.equal(t.states.at(-1), 'ready');
  });

  it('zonder correlationId: een laat event van een gestopt bericht telt niet', async () => {
    await t.presenter.speak(['Oud bericht.'], 0, 1);
    t.say('Oud', { correlationId: undefined, id: 'persona::oud' });
    t.presenter.stop();
    await t.presenter.speak(['Nieuw bericht.'], 0, 2);
    t.say(' bericht.', { correlationId: undefined, id: 'persona::oud' }); // laat
    assert.equal(t.states.at(-1), 'loading');
    t.say('Nieuw', { correlationId: undefined, id: 'persona::nieuw' });
    assert.equal(t.states.at(-1), 'speaking');
    t.say(' bericht.', { correlationId: undefined, id: 'persona::oud' }); // nog later
    assert.equal(t.states.at(-1), 'speaking', 'het oude bericht beëindigt het nieuwe niet');
  });

  it('zonder correlationId: een onderbroken bericht wordt nooit het nieuwe fragment', async () => {
    await t.presenter.speak(['Oud bericht.'], 0, 1);
    t.presenter.stop(); // vóór het begon: nog geen bericht gekoppeld
    await t.presenter.speak(['Nieuw bericht.'], 0, 2);
    t.say('Oud', { correlationId: undefined, id: 'persona::oud', interrupted: true });
    assert.equal(t.states.at(-1), 'loading');
    t.say('Nieuw', { correlationId: undefined, id: 'persona::nieuw' });
    assert.equal(t.states.at(-1), 'speaking');
  });

  it('herkent de verpakte correlationId zoals Anam die live terugstuurt', async () => {
    await t.presenter.speak(LINES, 0, 1);
    const mine = t.calls.chunks[0].correlationId;
    t.say('Eerste', { correlationId: `external::${mine}::5285161a-4c0`, id: 'persona::external::x::1' });
    assert.equal(t.states.at(-1), 'speaking');
    t.say('Oud', { correlationId: 'external::iets-anders::1', id: 'persona::external::y::1' });
    assert.equal(t.sentences.at(-1), 0, 'een ander fragment telt niet');
  });
});
