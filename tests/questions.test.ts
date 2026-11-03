import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NewsArticle } from '../lib/articles.ts';
import {
  answerQuestion,
  candidates,
  clock,
  isOverviewQuestion,
  newsWindow,
  noRecentNews,
  NOT_FOUND,
  OTHER_STORY,
  OVERVIEW,
  overviewStories,
  periodLabel,
  pickRoute,
  recentStories,
  type Candidate,
} from '../lib/questions.ts';

// Een vraag over ander nieuws van vandaag: Nova antwoordt uit het bericht waar de vraag over gaat,
// niet alleen uit het bericht in beeld. Altijd uit een bron, en bij twijfel het eerste antwoord.

const story = (id: string, title = `Titel ${id}`) => ({ id, title, body: `Brontekst van ${id}.` }) as NewsArticle;
const ARTICLES = [story('boetes'), story('volkswagen', 'Dramatische cijfers voor Volkswagen'), story('songfestival')];

type A = { spoken: string; mode: 'ai' | 'fallback'; aboutArticle?: boolean; attempts: string[] };

function deps(answers: Record<string, Partial<A>>, routeTo: string | null | 'error') {
  const asked: string[] = [];
  const routed: Candidate[][] = [];
  return {
    asked,
    routed,
    deps: {
      overview: async (minutes: number | null) => {
        asked.push(minutes ? `overzicht:${minutes}` : 'overzicht');
        return { spoken: 'Dit is het nieuws.', mode: 'ai' as const, attempts: ['model-overzicht'] };
      },
      answer: async (article: NewsArticle, previous: unknown[]) => {
        asked.push(`${article.id}:${previous.length}`);
        return { spoken: `Antwoord uit ${article.id}.`, mode: 'ai' as const, attempts: [`model-${article.id}`], ...answers[article.id] };
      },
      route: async (list: Candidate[]) => {
        routed.push(list);
        if (routeTo === 'error') throw new Error('model weg');
        return { id: routeTo, attempts: ['router'] };
      },
    },
  };
}

describe('vraag over ander nieuws van vandaag', () => {
  it('gaat de vraag over dit bericht: één antwoord, geen zoektocht', async () => {
    const t = deps({}, 'volkswagen');
    const r = await answerQuestion(ARTICLES[0], 'Hoe zit het met de boetes?', [], ARTICLES, t.deps);
    assert.equal(r.article.id, 'boetes');
    assert.equal(r.switchedFrom, null);
    assert.deepEqual(t.asked, ['boetes:0']);
    assert.equal(t.routed.length, 0);
  });

  it('gaat hij over een ander bericht: antwoord uit dat bericht, met een nieuwe context', async () => {
    const t = deps({ boetes: { aboutArticle: false } }, 'volkswagen');
    const r = await answerQuestion(ARTICLES[0], 'Hoe zit het met de boetes?', [{ action: 'core', spoken: 'Eerdere uitleg.' }], ARTICLES, t.deps);
    assert.equal(r.article.id, 'volkswagen');
    assert.equal(r.switchedFrom, 'boetes');
    assert.equal(r.answer.spoken, `${OTHER_STORY} Antwoord uit volkswagen.`);
    assert.deepEqual(t.asked, ['boetes:1', 'volkswagen:0'], 'de eerdere uitleg hoort bij het andere bericht');
    assert.deepEqual(r.answer.attempts, ['model-boetes', 'router', 'model-volkswagen']);
    assert.deepEqual(t.routed[0].map((c) => c.id), ['volkswagen', 'songfestival'], 'het bericht in beeld zelf niet');
  });

  it('niets gevonden: het eerste antwoord, en eerlijk dat het ook elders niet staat', async () => {
    const t = deps({ boetes: { aboutArticle: false, spoken: 'Daar gaat dit bericht niet over.' } }, null);
    const r = await answerQuestion(ARTICLES[0], 'Hoe zit het met de boetes?', [], ARTICLES, t.deps);
    assert.equal(r.article.id, 'boetes');
    assert.equal(r.answer.spoken, `Daar gaat dit bericht niet over. ${NOT_FOUND}`);
  });

  it('bij twijfel geen wissel en geen bewering: fout bij zoeken, of ook dat bericht gaat er niet over', async () => {
    for (const [answers, routeTo] of [
      [{ boetes: { aboutArticle: false } }, 'error'],
      [{ boetes: { aboutArticle: false }, volkswagen: { aboutArticle: false } }, 'volkswagen'],
      [{ boetes: { aboutArticle: false }, volkswagen: { mode: 'fallback' } }, 'volkswagen'],
    ] as const) {
      const t = deps(answers as Record<string, Partial<A>>, routeTo);
      const r = await answerQuestion(ARTICLES[0], 'Hoe zit het met de boetes?', [], ARTICLES, t.deps);
      assert.equal(r.article.id, 'boetes', JSON.stringify([answers, routeTo]));
      assert.equal(r.switchedFrom, null);
      assert.equal(r.answer.spoken, 'Antwoord uit boetes.', 'niets toegevoegd');
    }
  });

  it('bij de terugval (geen taalmodel) wordt niet gezocht', async () => {
    const t = deps({ boetes: { mode: 'fallback', aboutArticle: false } }, 'volkswagen');
    await answerQuestion(ARTICLES[0], 'Hoe zit het met de boetes?', [], ARTICLES, t.deps);
    assert.equal(t.routed.length, 0);
  });
});

describe('een algemene vraag over het nieuws', () => {
  it('herkent algemene vragen, ook zonder hoofdletters of vraagteken', () => {
    for (const q of [
      'Wat gebeurde er vandaag?',
      'wat gebeurde er vandaag',
      'Wat is er vandaag gebeurd?',
      'Wat is er nog meer?',
      'Wat is het nieuws?',
      'Vertel me het nieuws van vandaag',
      'Is er ander nieuws?',
      'Wat speelt er vandaag in Nederland?',
      'Nova, wat is er verder gebeurd?',
    ]) {
      assert.equal(isOverviewQuestion(q), true, q);
    }
  });

  it('een vraag met een onderwerp, of over dit bericht, is geen overzicht', () => {
    for (const q of [
      'Wat gebeurde er vandaag met de boeren?',
      'Wat is er gebeurd?',
      'Vertel me meer',
      'Wat betekent dit nieuws voor mij?',
      'Wat is er nog meer over de stikstofwet?',
      'Waarom?',
      '',
    ]) {
      assert.equal(isOverviewQuestion(q), false, q);
    }
  });

  it('krijgt een overzicht, zonder eerst het bericht in beeld te vragen', async () => {
    const t = deps({}, 'volkswagen');
    const r = await answerQuestion(ARTICLES[0], 'Wat gebeurde er vandaag?', [], ARTICLES, t.deps);
    assert.equal(r.overview, true);
    assert.equal(r.article.id, 'boetes', 'het bericht in beeld blijft staan');
    assert.equal(r.switchedFrom, null);
    assert.equal(r.answer.spoken, 'Dit is het nieuws.');
    assert.deepEqual(t.asked, ['overzicht']);
  });

  it('niet herkend, maar de routeervraag ziet een algemene vraag: ook een overzicht', async () => {
    const t = deps({ boetes: { aboutArticle: false } }, OVERVIEW);
    const r = await answerQuestion(ARTICLES[0], 'Waar hebben ze het allemaal over?', [], ARTICLES, t.deps);
    assert.equal(r.overview, true);
    assert.equal(r.article.id, 'boetes');
    assert.equal(r.answer.spoken, 'Dit is het nieuws.', 'geen "niet gevonden" erachter');
    assert.deepEqual(r.answer.attempts, ['model-boetes', 'router', 'model-overzicht']);
  });

  it('het overzicht gaat over de eerste vijf berichten', () => {
    assert.deepEqual(overviewStories([1, 2, 3, 4, 5, 6, 7]), [1, 2, 3, 4, 5]);
  });
});

describe('het nieuws van de afgelopen minuten', () => {
  it('leest het tijdvak uit de vraag', () => {
    const cases: [string, number | null][] = [
      ['Wat is er de afgelopen 10 minuten gebeurd?', 10],
      ['wat is er de afgelopen tien minuten gebeurd', 10],
      ['Wat is er het afgelopen kwartier gebeurd?', 15],
      ['Nieuws van het laatste half uur?', 30],
      ['Wat is er het afgelopen uur gebeurd?', 60],
      ['Wat gebeurde er de laatste 2 uur?', 120],
      ['Wat is er de afgelopen paar minuten gebeurd?', 10],
      ['Wat is er de afgelopen minuut gebeurd?', 1],
      ['Wat is het laatste nieuws?', null],
      ['Wat gebeurde er vandaag?', null],
      ['De afgelopen 900 uur', 24 * 60],
    ];
    for (const [q, minutes] of cases) assert.equal(newsWindow(q), minutes, q);
  });

  it('een tijdvak maakt het een vraag over het nieuws, maar een onderwerp niet', () => {
    assert.equal(isOverviewQuestion('Wat is er de afgelopen 10 minuten gebeurd?'), true);
    assert.equal(isOverviewQuestion('Wat is er het laatste uur gebeurd in Nederland?'), true);
    assert.equal(isOverviewQuestion('Wat is er de afgelopen 10 minuten met de boeren gebeurd?'), false);
  });

  it('geeft het tijdvak door aan het overzicht', async () => {
    const t = deps({}, null);
    await answerQuestion(ARTICLES[0], 'Wat is er de afgelopen 10 minuten gebeurd in het nieuws?', [], ARTICLES, t.deps);
    assert.deepEqual(t.asked, ['overzicht:10']);
  });

  const now = Date.parse('2026-11-03T14:40:00Z');
  const at = (id: string, minutesAgo: number) => ({
    id,
    title: `Bericht ${id}`,
    publisher: 'NOS',
    published: new Date(now - minutesAgo * 60_000).toISOString(),
  });
  const list = [at('oud', 45), at('net', 2), at('kwartier', 14), at('vijf', 5)];

  it('alleen berichten uit het tijdvak, nieuwste eerst', () => {
    assert.deepEqual(recentStories(list, 10, now).map((a) => a.id), ['net', 'vijf']);
    assert.deepEqual(recentStories(list, 15, now).map((a) => a.id), ['net', 'vijf', 'kwartier']);
    assert.deepEqual(recentStories(list, 1, now), []);
  });

  it('niets nieuws: eerlijk zeggen, met het nieuwste bericht en de tijd', () => {
    assert.equal(clock('2026-11-03T14:38:00Z'), '15.38', 'Nederlandse tijd, met een punt');
    assert.equal(
      noRecentNews(list, periodLabel(1)),
      'In de afgelopen minuut is er geen nieuw bericht van de NOS gekomen. Het nieuwste bericht kwam om 15.38 uur: Bericht net.',
    );
    assert.equal(periodLabel(10), 'de afgelopen 10 minuten');
    assert.equal(periodLabel(60), 'het afgelopen uur');
    assert.equal(periodLabel(120), 'de afgelopen 2 uur');
  });
});

describe('kiezen uit de berichten van vandaag', () => {
  const list = candidates(ARTICLES, 'boetes');

  it('een lijst met titel en begin, zonder het bericht in beeld', () => {
    assert.deepEqual(list.map((c) => c.id), ['volkswagen', 'songfestival']);
    assert.equal(list[0].opening, 'Brontekst van volkswagen.');
  });

  it('neemt alleen een id die in de lijst staat', () => {
    assert.equal(pickRoute('{"id":"songfestival"}', list), 'songfestival');
    assert.equal(pickRoute('{"id":"boetes"}', list), null, 'het bericht in beeld zelf telt niet');
    assert.equal(pickRoute('{"id":null}', list), null);
    assert.equal(pickRoute('{"id":"overzicht"}', list), OVERVIEW, 'een algemene vraag');
    assert.equal(pickRoute('geen json', list), null);
  });
});
