import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { Explanation } from '../lib/ai.ts';
import type { NewsArticle } from '../lib/articles.ts';
import { asForeground, clearCores, coreExplanation, warmCores, warmWhenQuiet } from '../lib/corecache.ts';

// De klaargezette basisuitleg: één aanvraag per artikel- en promptversie, ook als Start en het
// klaarzetten tegelijk vragen. Een terugval-antwoord wordt niet bewaard. Voorbereiding gaat niet
// voor een echte gebruikersvraag.

const article = (version = 'v1', id = 'a1') => ({ id, version }) as NewsArticle;
const answer = (mode: Explanation['mode'] = 'ai'): Explanation => ({
  spoken: 'Kern.',
  mode,
  model: mode === 'ai' ? 'm' : null,
  promptVersion: 'p1',
  attempts: [],
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('basisuitleg klaarzetten', () => {
  beforeEach(() => clearCores());

  it('meldt miss, pending en ready, en vraagt het model één keer', async () => {
    let calls = 0;
    const generate = async () => {
      calls++;
      await wait(10);
      return answer();
    };
    const first = coreExplanation(article(), 'p1', generate);
    const second = coreExplanation(article(), 'p1', generate); // terwijl de eerste nog loopt
    assert.equal((await first).cache, 'miss');
    assert.equal((await second).cache, 'pending');
    assert.equal((await coreExplanation(article(), 'p1', generate)).cache, 'ready');
    assert.equal(calls, 1);
  });

  it('klaarzetten en Start tegelijk: één aanvraag, Start meldt pending', async () => {
    let calls = 0;
    const generate = async () => {
      calls++;
      await wait(10);
      return answer();
    };
    const warming = warmCores([article()], 'p1', generate);
    const start = await coreExplanation(article(), 'p1', generate);
    await warming;
    assert.equal(calls, 1);
    assert.equal(start.cache, 'pending');
  });

  it('een nieuwe artikel- of promptversie geeft een nieuwe uitleg', async () => {
    let calls = 0;
    const generate = async () => (calls++, answer());
    await coreExplanation(article('v1'), 'p1', generate);
    await coreExplanation(article('v2'), 'p1', generate);
    await coreExplanation(article('v2'), 'p2', generate);
    assert.equal(calls, 3);
  });

  it('bewaart geen terugval-antwoord: de volgende keer krijgt het model weer een kans', async () => {
    let calls = 0;
    const generate = async () => (calls++, answer(calls === 1 ? 'fallback' : 'ai'));
    assert.equal((await coreExplanation(article(), 'p1', generate)).mode, 'fallback');
    assert.equal((await coreExplanation(article(), 'p1', generate)).mode, 'ai');
    assert.equal((await coreExplanation(article(), 'p1', generate)).cache, 'ready');
    assert.equal(calls, 2);
  });

  it('voorbereiding wacht tot er even geen gebruikersaanvraag loopt', async () => {
    const order: string[] = [];
    const generate = async (a: NewsArticle) => (order.push(`voorbereiding ${a.id}`), answer());
    let finish!: () => void;
    const question = asForeground(() => new Promise<void>((r) => (finish = r)).then(() => order.push('vraag')));
    const warming = warmWhenQuiet([article('v1', 'next')], 'p1', generate, { quietMs: 30, pollMs: 5 });
    await wait(40);
    assert.deepEqual(order, [], 'niets terwijl de vraag loopt');
    finish();
    await question;
    await wait(10);
    assert.deepEqual(order, ['vraag'], 'en ook niet direct erna: eerst een rustige periode');
    assert.equal(await warming, true);
    assert.deepEqual(order, ['vraag', 'voorbereiding next']);
  });

  it('geeft het op als het niet rustig wordt, en dan maakt de klik het zelf', async () => {
    let calls = 0;
    const generate = async () => (calls++, answer());
    const busy = asForeground(() => wait(60));
    assert.equal(await warmWhenQuiet([article()], 'p1', generate, { quietMs: 10, pollMs: 5, maxWaitMs: 30 }), false);
    await busy;
    assert.equal(calls, 0);
    assert.equal((await coreExplanation(article(), 'p1', generate)).cache, 'miss');
  });
});
