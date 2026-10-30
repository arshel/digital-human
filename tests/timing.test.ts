import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CycleTiming } from '../components/presenter/timing.ts';
import { idleTimerRuns } from '../components/presenter/types.ts';

// Metingen per klik: een laat event van een oude klik mag de meting van de nieuwe niet raken.

describe('metingen per cyclus', () => {
  it('meet vanaf de klik en sluit af als Nova hoorbaar is', () => {
    const t = new CycleTiming();
    t.start(1, 'core', 1000);
    t.event({ step: 'connect-start', at: 1010 });
    t.text(1, 1300, { cache: 'ready', generateMs: 2 });
    t.event({ step: 'connected', at: 9000, detail: 'legacy' });
    t.event({ step: 'speak-sent', at: 9010, cycle: 1 });
    t.event({ step: 'playing', at: 12000, cycle: 1 });
    assert.equal(t.event({ step: 'audio', at: 12100, cycle: 1 }), 'done');
    const report = t.flush();
    assert.deepEqual(report?.steps, { 'connect-start': 10, text: 300, connected: 8000, 'speak-sent': 8010, playing: 11000, audio: 11100 });
    assert.equal(report?.stream, 'legacy');
    assert.equal(report?.server?.cache, 'ready');
    assert.equal(report?.replaced, false);
    assert.equal(t.flush(), null, 'maar één keer');
  });

  it('een laat event van een oude klik telt niet mee', () => {
    const t = new CycleTiming();
    t.start(1, 'core', 0);
    const replaced = t.start(2, 'question', 5000);
    assert.equal(replaced?.cycle, 1);
    assert.equal(replaced?.replaced, true);
    t.event({ step: 'playing', at: 6000, cycle: 1 }); // het oude fragment, te laat
    t.text(1, 6100, { cache: 'miss' });
    assert.equal(t.event({ step: 'audio', at: 6200, cycle: 1 }), null);
    t.event({ step: 'playing', at: 8000, cycle: 2 });
    const report = t.flush(false, 2);
    assert.deepEqual(report?.steps, { playing: 3000 });
    assert.equal(report?.server, undefined);
  });

  it('noteert waarom een verbinding dicht ging, bij de klik die daardoor opnieuw verbindt', () => {
    const t = new CycleTiming();
    t.start(3, 'more', 0);
    t.event({ step: 'closed', at: 1, detail: 'stop' });
    assert.deepEqual(t.flush()?.closed, ['stop']);
  });

  it('afsluiten na een time-out raakt een nieuwere klik niet', () => {
    const t = new CycleTiming();
    t.start(1, 'core', 0);
    t.start(2, 'core', 10);
    assert.equal(t.flush(false, 1), null);
    assert.equal(t.flush(false, 2)?.cycle, 2);
  });
});

describe('inactiviteitstimer', () => {
  it('loopt alleen als Nova echt stilstaat', () => {
    for (const s of ['connecting', 'loading', 'speaking'] as const) assert.equal(idleTimerRuns(s, false), false, s);
    for (const s of ['ready', 'paused', 'error'] as const) assert.equal(idleTimerRuns(s, false), true, s);
    assert.equal(idleTimerRuns('ready', true), false, 'niet tijdens genereren');
    assert.equal(idleTimerRuns('paused', true), false);
  });
});
