import type { Article } from './news';

export type AnchorReply = { text: string; articleId: string | null };

// Terugval zonder taalmodel: regelgebaseerd, antwoordt met letterlijke zinnen uit
// de artikelen. lib/ai.ts gebruikt dit als Gemini ontbreekt of faalt, zodat een
// demo nooit stil valt.

// Woorden te algemeen om op te matchen. NL + EN: testers typen soms Engels.
const STOPWORDS = new Set([
  'waarom', 'wanneer', 'welke', 'hierover', 'daarover', 'eigenlijk', 'gebeurt',
  'wordt', 'worden', 'hebben', 'heeft', 'zijn', 'deze', 'dit', 'voor', 'over',
  'niet', 'nog', 'wat', 'wie', 'hoe', 'mij', 'mijn', 'jij', 'jouw', 'ook', 'maar',
  'story', 'stories', 'this', 'that', 'does', 'tell', 'more', 'about', 'have',
  'what', 'which', 'when', 'first', 'second', 'third', 'last', 'next',
  'previous', 'important', 'matter', 'news', 'verhaal', 'verhalen',
]);

function sentences(text: string) {
  return text.split(/(?<=[.!?]["”]?)\s+/);
}

function keywords(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9à-ÿ]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

function scoreText(questionWords: string[], text: string) {
  const words = new Set(keywords(text));
  return questionWords.filter((w) => words.has(w)).length;
}

function storyIntro(article: Article): AnchorReply {
  return { text: sentences(article.body).slice(0, 3).join(' '), articleId: article.id };
}

// "Waarom is dit belangrijk" beantwoorden we met de zinnen die de inzet
// concreet maken: bedragen, aantallen, een citaat. Geen aanname, alleen selectie.
// Slaat de openingszinnen over: die heeft de gebruiker net al gehoord.
function stakesAnswer(article: Article): AnchorReply {
  const rest = sentences(article.body).slice(3);
  const withStakes = rest.filter((s) => /\d|["“]/.test(s));
  const picked = (withStakes.length ? withStakes : rest).slice(0, 2);
  return { text: picked.join(' '), articleId: article.id };
}

function sentenceAnswer(qWords: string[], article: Article): AnchorReply {
  const matches = sentences(article.body)
    .map((s, i) => ({ s, i, score: scoreText(qWords, s) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .sort((a, b) => a.i - b.i)
    .map((m) => m.s);
  return { text: matches.join(' '), articleId: article.id };
}

function notCovered(articles: Article[]): AnchorReply {
  const topics = [...new Set(articles.map((a) => a.topic))].join(', ');
  return { text: `Daar heb ik nu geen verhaal over. Vandaag gaat het over: ${topics}.`, articleId: null };
}

const ORDINALS: [RegExp, number][] = [
  [/\b(eerste|first|verhaal ?1|story ?1)\b/, 0],
  [/\b(tweede|second|verhaal ?2|story ?2)\b/, 1],
  [/\b(derde|laatste|third|last|verhaal ?3|story ?3)\b/, 2],
];

const NEXT = /\b(volgende|next)\b/;
const PREVIOUS = /\b(vorige|previous|terug|back)\b/;
const STAKES = /\b(belangrijk|ertoe doet|why.*(important|matter)|matter to me|voor mij)\b/;
const CATALOG = /(heb (je|jullie)|hebben jullie|is er).{0,20}nieuws|(do you have|got any).{0,20}news|nieuws over/;

const TOPIC_SYNONYMS: Record<string, string[]> = {
  Vervoer: ['vervoer', 'ov', 'trein', 'bus', 'tram', 'metro', 'reizen', 'transport', 'traffic'],
  Onderwijs: ['onderwijs', 'school', 'hogeschool', 'studie', 'tentamen', 'education', 'study', 'exam'],
  Wonen: ['wonen', 'woning', 'kamer', 'huur', 'housing', 'rent', 'room', 'verkamering'],
};

function matchByTopic(question: string, articles: Article[]) {
  const words = question.split(/[^a-z0-9à-ÿ]+/);
  // Korte termen (ov, bus) exact, zodat "over" niet als "ov" telt; langere als prefix ("woningen").
  const hit = (t: string) => words.some((w) => (t.length <= 3 ? w === t : w.startsWith(t)));
  return articles.find((a) => TOPIC_SYNONYMS[a.topic]?.some(hit));
}

// Bij het laden van de pagina: alle geladen artikelen kort introduceren.
// Verhaal 1 wordt de actieve context tot de gebruiker doorschuift of iets anders opzoekt.
export function briefing(articles: Article[]): AnchorReply {
  const parts = articles.map((a, i) => {
    const cue = i === 0 ? 'Eerst' : i === articles.length - 1 ? 'Tot slot' : 'Dan';
    return `${cue}: ${a.title}. ${sentences(a.body)[0]}`;
  });
  return { text: `Drie verhalen vandaag. ${parts.join(' ')} Waar wil je meer over weten?`, articleId: articles[0].id };
}

export function respond(question: string, articles: Article[], activeIndex: number | null): AnchorReply {
  const q = question.toLowerCase();

  const ordinal = ORDINALS.find(([re]) => re.test(q));
  if (ordinal) return storyIntro(articles[ordinal[1]]);

  if (NEXT.test(q)) {
    const last = articles.length - 1;
    if (activeIndex === last) {
      return { text: 'Dat was het laatste verhaal van vandaag. Vraag gerust door, of ga terug naar een eerder verhaal.', articleId: articles[last].id };
    }
    return storyIntro(articles[(activeIndex ?? -1) + 1]);
  }
  if (PREVIOUS.test(q)) return storyIntro(articles[Math.max((activeIndex ?? 1) - 1, 0)]);

  if (CATALOG.test(q)) {
    const byTopic = matchByTopic(q, articles);
    return byTopic ? storyIntro(byTopic) : notCovered(articles);
  }

  if (activeIndex !== null && STAKES.test(q)) return stakesAnswer(articles[activeIndex]);

  const qWords = keywords(question);
  const best = articles
    .map((a, i) => ({ i, score: scoreText(qWords, `${a.title} ${a.topic} ${a.body}`) }))
    .sort((a, b) => b.score - a.score)[0];

  if (best.score > 0) return sentenceAnswer(qWords, articles[best.i]);

  if (activeIndex !== null) {
    const a = articles[activeIndex];
    return { text: `Dat zegt dit verhaal niet met zoveel woorden. ${sentences(a.body)[0]}`, articleId: a.id };
  }

  return notCovered(articles);
}
