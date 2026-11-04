import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import type { NewsArticle } from '../lib/articles.ts';
import { CLASSIFY_SYSTEM } from '../lib/prompt.ts';
import { answerQuestion, overviewSelection, recentStories, type Beslissing, type Period } from '../lib/questions.ts';
import { checkStructure } from '../scripts/evaluate-questions.mjs';

// Uit de review van 4 november 2026 (reports/nova-vragen-review-2026-11-04.md). De open fouten
// (TODO) zijn met de beslissing vooraf opgelost en staan hier als gewone tests. Het nepmodel kiest
// de beslissing die een goed model zou kiezen: deze tests bewijzen de afhandeling daarvan, niet dat
// het echte model zo kiest. Dat meet scripts/evaluate-questions.mjs.

const NOW = Date.parse('2026-11-04T14:00:00Z');
const set = JSON.parse(readFileSync(new URL('../evaluation/questions.nl.json', import.meta.url), 'utf8'));
const articles = (JSON.parse(readFileSync(new URL('../evaluation/context.nl.json', import.meta.url), 'utf8')) as NewsArticle[]).map(
  (a, i) => ({ ...a, publisher: 'NOS', published: new Date(NOW - (i + 1) * 5 * 60_000).toISOString() }) as NewsArticle,
);
const story = (id: string) => articles.find((a) => a.id === id)!;

function fake(decision: Beslissing | { fout: string }, first: { spoken?: string } = {}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      classify: async () => ({ result: 'fout' in decision ? decision : { beslissing: decision }, attempts: ['beslissing'] }),
      answer: async (a: NewsArticle) => {
        calls.push(a.id);
        return { spoken: 'Dit is het antwoord.', mode: 'ai' as const, attempts: [a.id], ...(calls.length === 1 ? first : {}) };
      },
      overview: async (stories: NewsArticle[], period: Period | undefined) => {
        calls.push(`overzicht:${stories.map((s) => s.region).join(',')}:${period?.of ?? '-'}`);
        return { spoken: 'Dit is het overzicht.', mode: 'ai' as const, attempts: ['overzicht'] };
      },
      fixed: (spoken: string) => ({ spoken, mode: 'ai' as const, attempts: [] }),
    },
  };
}
const ask = (current: string, t: ReturnType<typeof fake>, list = articles) => answerQuestion(story(current), [], list, t.deps, NOW);

it('evaluatieset: minstens 60 unieke vragen met context, invoertype en inhoudelijke verwachting', () => {
  assert.ok(set.length >= 60);
  assert.equal(new Set(set.map((t: any) => t.id)).size, set.length);
  for (const t of set) {
    assert.ok(story(t.current));
    assert.ok(t.expected.rubric);
    assert.ok(['getypt', 'gesproken-transcript'].includes(t.input));
    if (t.expected.target) assert.ok(story(t.expected.target));
  }
  for (const category of ['bericht', 'begrip', 'ander-nl', 'buitenlands', 'overzicht-nl', 'overzicht-buitenland', 'geen-nieuws']) {
    assert.ok(set.filter((t: any) => t.expected.kind === category).length >= 10);
  }
});

// De zes demo-fouten, met de beslissing die erbij hoort.
for (const [question, current, decision, expected] of [
  ['Wat gebeurde er vandaag?', 'haarlem', { soort: 'overzicht', regio: 'nl', minuten: null, dag: 'vandaag' }, 'overzicht'],
  ['wat is er vandaag in amerika gaande', 'haarlem', { soort: 'ander_bericht', id: 'amerika' }, 'amerika'],
  ['wat is het Congres', 'amerika', { soort: 'begrip', begrip: 'Congres' }, 'amerika'],
  ['wat gebeurde er in gaza', 'stikstof', { soort: 'geen_match', onderwerp: 'Gaza' }, 'geen'],
  ['waar heb je wel nieuws over', 'stikstof', { soort: 'overzicht', regio: 'nl', minuten: null, dag: null }, 'overzicht'],
  ['Wat gebeurt er in Oekraïne?', 'haarlem', { soort: 'ander_bericht', id: 'oekraine' }, 'oekraine'],
] as const) {
  it(`demo-regressie (nepmodel): ${question}`, async () => {
    const t = fake(decision as Beslissing);
    const r = await ask(current, t);
    if (expected === 'overzicht') {
      assert.equal(r.overview, true);
      assert.equal(t.calls.length, 1);
    } else if (expected === 'geen') {
      assert.equal(r.answer.spoken, 'Ik heb vandaag geen nieuws over Gaza.');
    } else {
      assert.equal(r.article.id, expected);
      if (expected !== current) assert.ok(r.answer.spoken.startsWith('Dat gaat over buitenlands nieuws van vandaag.'));
    }
  });
}

// F1: gisteren wordt gefilterd, niet stilletjes het nieuwste nieuws.
it('gisteren: alleen berichten van gisteren', () => {
  const list = [
    { id: 'nu', published: '2026-11-04T10:00:00Z', region: 'nl' as const },
    { id: 'gisteren', published: '2026-11-03T10:00:00Z', region: 'nl' as const },
  ];
  assert.deepEqual(overviewSelection(list, { soort: 'overzicht', regio: 'nl', minuten: null, dag: 'gisteren' }, NOW).stories.map((a) => a.id), ['gisteren']);
});

// F2: de bedoeling komt uit de beslissing, niet uit een woordenlijst. De opdracht noemt het verschil.
it('de beslisopdracht kent het verschil tussen "wat is nieuws?" en "wat is het nieuws?"', () => {
  assert.match(CLASSIFY_SYSTEM, /"wat is nieuws\?" vraagt wat een woord betekent, dus "begrip"/);
  assert.match(CLASSIFY_SYSTEM, /"Wat is het nieuws\?" vraagt naar het nieuws, dus "overzicht"/);
  assert.match(CLASSIFY_SYSTEM, /wat speelt er momenteel\?/);
});

// F3: de antwoordtekst stuurt de route niet meer.
it('"Ter uitleg:" in een antwoord houdt een gekozen ander bericht niet tegen', async () => {
  const t = fake({ soort: 'ander_bericht', id: 'oekraine' }, { spoken: 'Ter uitleg: Dit bericht gaat niet over Oekraïne.' });
  assert.equal((await ask('haarlem', t)).article.id, 'oekraine');
});

// F4: ook met maar één bericht een eerlijke geen-nieuws-zin.
it('één artikel en een vraag over iets anders: geen irrelevante uitleg', async () => {
  const t = fake({ soort: 'geen_match', onderwerp: 'Gaza' });
  const r = await ask('stikstof', t, [story('stikstof')]);
  assert.equal(r.answer.spoken, 'Ik heb vandaag geen nieuws over Gaza.');
});

// F5: twijfel, een fout of een gemist bericht is geen bewijs dat er geen nieuws is.
it('onzeker, een fout, of een onderwerp dat wel in een bericht staat: geen "geen nieuws"', async () => {
  for (const decision of [{ soort: 'onzeker' }, { fout: 'id niet in de lijst' }, { soort: 'geen_match', onderwerp: 'Oekraïne' }] as const) {
    const r = await ask('haarlem', fake(decision as Beslissing));
    assert.doesNotMatch(r.answer.spoken, /geen nieuws/, JSON.stringify(decision));
    assert.equal(r.article.id, 'haarlem');
  }
});

// F6: een inhoudelijke ontkenning in het antwoord laat Nova niet verder zoeken.
it('"praten niet over Oekraïne" in een antwoord over dit bericht blijft een antwoord over dit bericht', async () => {
  const t = fake({ soort: 'dit_bericht' }, { spoken: 'Volgens dit bericht praten de partijen niet over Oekraïne.' });
  const r = await ask('haarlem', t);
  assert.equal(r.article.id, 'haarlem');
  assert.equal(r.answer.spoken, 'Volgens dit bericht praten de partijen niet over Oekraïne.');
  assert.deepEqual(t.calls, ['haarlem']);
});

// F7: de pogingen van de beslissing tellen mee, ook zonder gekozen bericht.
it('zoekpogingen blijven meetbaar wanneer er geen bericht gekozen wordt', async () => {
  const r = await ask('haarlem', fake({ soort: 'geen_match', onderwerp: 'Gaza' }));
  assert.deepEqual(r.answer.attempts, ['beslissing']);
});

// F8: een tijdvak heeft een bovengrens.
it('tijdvak bevat geen toekomstige publicaties', () => {
  assert.deepEqual(recentStories([{ published: '2026-11-05T12:00:00Z' }], 10, Date.parse('2026-11-04T12:00:00Z')), []);
});

it('evaluatiescript keurt verkeerde wissel, fallback en ontbrekend overzicht af', () => {
  const bindings = { haarlem: 'h', oekraine: 'o' };
  const test = set.find((t: any) => t.id === 'buitenlands-01');
  const good = { mode: 'ai', spoken: 'Dat gaat over buitenlands nieuws van vandaag. Volgens de burgemeester zijn er gewonden.', articleId: 'o', switchedFrom: 'h', overview: false };
  assert.equal(checkStructure(test, good, bindings), true);
  assert.equal(checkStructure(test, { ...good, articleId: 'h' }, bindings), false);
  assert.equal(checkStructure(test, { ...good, mode: 'fallback' }, bindings), false);
  assert.equal(checkStructure(set.find((t: any) => t.id === 'overzicht-nl-01'), { ...good, articleId: 'h' }, bindings), false);
});
