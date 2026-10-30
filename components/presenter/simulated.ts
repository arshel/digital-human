import type { Presenter, PresenterEvents, Timing } from './types.ts';

// De presentator in de ontwikkelmodus. Anam wordt niet aangeroepen. Heeft de browser een
// Nederlandse stem, dan leest die voor (Web Speech API, per zin een uiting, dus echte events per
// zin). Zonder stem loopt een timer per zin, zodat alle statussen te testen zijn; dat tempo is
// gesimuleerd. Verbinding maken en verbroken verbinding zijn nagespeeld (simulateDrop).
//
// pause() en resume() van de browser gebruiken we niet: op Android stopt pause() de stem
// helemaal, en Google-stemmen in Chrome hervatten soms niet. Pauze breekt de stem af; verder
// begint de onderbroken zin opnieuw.

const RATE = 1; // natuurlijk tempo; langzamer klinkt al snel schools
const CONNECT_MS = 700;
const WORD_MS = 380; // gesimuleerd tempo zonder stem
const SENTENCE_GAP_MS = 300;

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

function browserSynth() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

export class SimulatedPresenter implements Presenter {
  private events: PresenterEvents;
  private synth: SpeechSynthesis | null;
  private voice: SpeechSynthesisVoice | null = null;
  private connected = false;
  private connecting: Promise<boolean> | null = null;
  private lines: string[] = [];
  private at = 0;
  private state: 'ready' | 'speaking' | 'paused' = 'ready';
  // Elke start of stop begint een nieuwe beurt; events van een oude beurt tellen niet meer.
  private run = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Vasthouden: zonder verwijzing ruimt Chrome de uiting soms op en blijven de events weg.
  private utterance: SpeechSynthesisUtterance | null = null;

  constructor(events: PresenterEvents, synth: SpeechSynthesis | null = browserSynth()) {
    this.events = events;
    this.synth = synth;
    if (synth) {
      const pick = () => (this.voice = dutchVoice(synth.getVoices()));
      pick();
      synth.addEventListener?.('voiceschanged', pick);
    }
  }

  get canResume() {
    return this.state === 'paused';
  }

  get timing(): Timing {
    return this.voice ? 'sentence' : 'simulated';
  }

  connect() {
    if (this.connected) return Promise.resolve(true);
    if (this.connecting) return this.connecting;
    this.events.onState('connecting');
    this.connecting = new Promise<boolean>((resolve) => {
      setTimeout(() => {
        this.connected = true;
        this.connecting = null;
        this.events.onState('ready');
        resolve(true);
      }, CONNECT_MS);
    });
    // iOS laat een pagina pas praten na een tik: een stille uiting tijdens de klik op Start.
    if (this.voice && this.synth) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      this.synth.speak(u);
    }
    return this.connecting;
  }

  async speak(sentences: string[], from = 0) {
    await this.connect();
    this.halt();
    this.lines = sentences;
    this.state = 'speaking';
    this.events.onState('speaking');
    this.say(from, ++this.run);
  }

  private say(i: number, id: number) {
    if (id !== this.run) return;
    if (i >= this.lines.length) {
      this.state = 'ready';
      this.utterance = null;
      this.events.onSentence(-1);
      this.events.onState('ready');
      return;
    }
    this.at = i;
    this.events.onSentence(i);
    if (this.voice && this.synth) {
      const u = new SpeechSynthesisUtterance(this.lines[i]);
      u.voice = this.voice;
      u.lang = this.voice.lang;
      u.rate = RATE;
      u.onend = () => this.say(i + 1, id);
      u.onerror = () => {
        // Zelf gestopt? Dan telt deze beurt al niet meer. Anders lukte voorlezen niet.
        if (id !== this.run) return;
        this.run++;
        this.state = 'paused';
        this.events.onState('paused', 'De browser wil eerst een klik. Druk op Verder.');
      };
      this.utterance = u;
      this.synth.speak(u);
    } else {
      const ms = this.lines[i].split(/\s+/).length * WORD_MS + SENTENCE_GAP_MS;
      this.timer = setTimeout(() => this.say(i + 1, id), ms);
    }
  }

  private halt() {
    this.run++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.utterance = null;
    this.synth?.cancel();
  }

  pause() {
    if (this.state !== 'speaking') return;
    this.halt();
    this.state = 'paused';
    this.events.onState('paused');
  }

  async resume() {
    if (this.state === 'paused') await this.speak(this.lines, this.at);
  }

  async replay() {
    if (this.lines.length) await this.speak(this.lines, 0);
  }

  stop() {
    this.halt();
    if (this.state === 'ready') return;
    this.state = 'ready';
    this.events.onSentence(-1);
    if (this.connected) this.events.onState('ready');
  }

  async disconnect(reason = '') {
    this.halt();
    this.state = 'ready';
    this.connected = false;
    this.events.onSentence(-1);
    this.events.onState(reason ? 'disconnected' : 'idle', reason);
  }

  // Alleen ontwikkelmodus: een weggevallen verbinding naspelen, midden in een uitleg.
  simulateDrop() {
    const was = this.state;
    this.halt();
    this.connected = false;
    if (was === 'speaking') this.state = 'paused';
    this.events.onState('disconnected', 'dropped');
  }
}
