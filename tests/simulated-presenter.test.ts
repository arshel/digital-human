import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { SimulatedPresenter } from '../components/presenter/simulated.ts';

// De gesimuleerde presentator (ontwikkelmodus) zonder browserstem: een timer per zin.

async function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const states: string[] = [];
  const sentences: number[] = [];
  const presenter = new SimulatedPresenter({ onState: (s) => states.push(s), onSentence: (i) => sentences.push(i) }, null);
  // In kleine stappen, zodat timers die tijdens het doorspoelen worden gezet ook afgaan.
  const advance = async (ms: number) => {
    for (let i = 0; i < ms; i += 100) {
      t.mock.timers.tick(100);
      await Promise.resolve();
    }
  };
  return { presenter, states, sentences, advance };
}

const LINES = ['Een korte zin.', 'Nog een korte zin.', 'De laatste zin.'];

describe('SimulatedPresenter', () => {
  it('doorloopt verbinden, spreken per zin en klaar', async (t) => {
    const s = await setup(t);
    const speaking = s.presenter.speak(LINES);
    await s.advance(1000);
    await speaking;
    assert.deepEqual(s.states.slice(0, 3), ['connecting', 'ready', 'speaking']);
    await s.advance(10_000);
    assert.deepEqual(s.sentences, [0, 1, 2, -1]);
    assert.equal(s.states.at(-1), 'ready');
    assert.equal(s.presenter.timing, 'simulated');
  });

  it('pauze en verder gaan door bij dezelfde zin', async (t) => {
    const s = await setup(t);
    const speaking = s.presenter.speak(LINES);
    await s.advance(1000);
    await speaking;
    await s.advance(1800); // eerste zin voorbij
    s.presenter.pause();
    assert.equal(s.presenter.canResume, true);
    await s.advance(10_000);
    assert.equal(s.states.at(-1), 'paused', 'stil tijdens de pauze');
    assert.equal(s.sentences.at(-1), 1);
    await s.presenter.resume();
    assert.equal(s.sentences.at(-1), 1, 'verder bij de onderbroken zin');
  });

  it('stoppen (volgend bericht) laat niets doorlopen', async (t) => {
    const s = await setup(t);
    const speaking = s.presenter.speak(LINES);
    await s.advance(1000);
    await speaking;
    s.presenter.stop();
    const before = s.sentences.length;
    await s.advance(10_000);
    assert.equal(s.sentences.length, before);
  });

  it('een verbroken verbinding kan verder', async (t) => {
    const s = await setup(t);
    const speaking = s.presenter.speak(LINES);
    await s.advance(1000);
    await speaking;
    s.presenter.simulateDrop();
    assert.equal(s.states.at(-1), 'disconnected');
    assert.equal(s.presenter.canResume, true);
  });
});
