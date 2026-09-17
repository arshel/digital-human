import { OPENING_COUNT, type Article } from './news';

export type AnchorReply = { text: string; articleId: string | null };

// Terugval zonder taalmodel: regelgebaseerd. lib/ai.ts gebruikt dit als Gemini ontbreekt
// of faalt, zodat een demo nooit stil valt.
//
// Alle woorden komen uit het artikel: deze code kiest zinnen, gooit weg en knipt af,
// maar schrijft nooit iets bij. Daardoor kan het geen feiten verzinnen, maar kan het ook
// niet echt herschrijven. Dichter bij A2/B1 komen we door kort te houden: hooguit drie
// zinnen, lange bronzinnen afgekapt bij een deelzin, en citaten alleen als er niets
// anders is. Het blijft zichtbaar minder goed dan Gemini; de interface meldt dat ook.

// Woorden te algemeen om op te matchen. NL + EN: testers typen soms Engels.
const STOPWORDS = new Set([
  'waarom', 'wanneer', 'welke', 'hierover', 'daarover', 'eigenlijk', 'gebeurt',
  'wordt', 'worden', 'hebben', 'heeft', 'zijn', 'deze', 'dit', 'voor', 'over',
  'niet', 'nog', 'wat', 'wie', 'hoe', 'mij', 'mijn', 'jij', 'jouw', 'ook', 'maar',
  'story', 'stories', 'this', 'that', 'does', 'tell', 'more', 'about', 'have',
  'what', 'which', 'when', 'first', 'second', 'third', 'last', 'next',
  'previous', 'important', 'matter', 'news', 'verhaal', 'verhalen',
  // Vraagwoorden: die staan ook in gewone nieuwszinnen en leverden anders een
  // toevalstreffer op ("hoeveel kost..." matchte "Hoeveel bomen zijn gekapt").
  'hoeveel', 'waarvoor', 'waardoor', 'waarover', 'precies', 'vertel', 'uitleg', 'betekent',
]);

const MAX_SENTENCE_WORDS = 18;
const SIMPLE_WORDS = 14;
const MAX_SENTENCES = 3;
const MAX_WORDS = 45;
const FOLLOW_UP = 'Wil je hier meer over weten?';

// Komma of puntkomma voor een voegwoord: daar kun je een lange zin afkappen zonder
// dat het eerste deel een halve zin wordt.
const CLAUSE = /;\s+|,\s+(?=(?:en|maar|want|omdat|terwijl|zodat|hoewel|waardoor|waarbij|die|dat)\b)/gi;
const QUOTED = /["“”]/;

function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function sentences(text: string) {
  return text
    .split(/(?<=[.!?]["”]?)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Lange bronzinnen veilig inkorten: liefst afkappen bij een deelzin, anders bij een heel
// woord met een beletselteken erachter, zodat zichtbaar is dat er meer stond.
function shorten(sentence: string) {
  const all = words(sentence);
  if (all.length <= MAX_SENTENCE_WORDS) return sentence;

  const fits = [...sentence.matchAll(CLAUSE)]
    .map((m) => m.index)
    .filter((i) => {
      const n = words(sentence.slice(0, i)).length;
      return n >= 6 && n <= MAX_SENTENCE_WORDS;
    });

  const cut = fits.at(-1);
  if (cut !== undefined) return `${sentence.slice(0, cut).replace(/[,;:]\s*$/, '')}.`;
  return `${all.slice(0, MAX_SENTENCE_WORDS).join(' ').replace(/[,;:]$/, '')}…`;
}

// Zinnen die zonder afkappen passen gaan voor: een afgekapte zin met een beletselteken
// leest slechter. Alleen als er te weinig korte zinnen zijn, mag er gekapt worden.
function fitting(list: string[]) {
  const short = list.filter((s) => words(s).length <= MAX_SENTENCE_WORDS);
  return short.length >= Math.min(2, list.length) ? short : list;
}

// Hooguit drie ingekorte zinnen, en niet meer dan MAX_WORDS woorden samen.
function compose(picked: string[]) {
  const out: string[] = [];
  let total = 0;

  for (const raw of fitting(picked)) {
    if (out.length === MAX_SENTENCES) break;
    const sentence = shorten(raw);
    const length = words(sentence).length;
    if (out.length > 0 && total + length > MAX_WORDS) break;
    out.push(sentence);
    total += length;
  }
  return out.join(' ');
}

// Citaten zijn meestal de langste en moeilijkste zinnen in een NOS-bericht. Ze vallen af
// zolang er gewone zinnen over zijn.
function withoutQuotes(list: string[]) {
  const plain = list.filter((s) => !QUOTED.test(s));
  return plain.length ? plain : list;
}

function reply(picked: string[], article: Article, closing = FOLLOW_UP): AnchorReply {
  const text = compose(picked);
  return { text: text ? `${text} ${closing}` : notInArticle(article).text, articleId: article.id };
}

function notInArticle(article: Article): AnchorReply {
  return {
    text: `Dat staat niet in dit bericht. Ik weet hier alleen dit over: ${shorten(article.title)}. Wil je iets anders weten?`,
    articleId: article.id,
  };
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

// De kern van een bericht: de eerste zinnen, zonder citaten.
function storyIntro(article: Article): AnchorReply {
  return reply(withoutQuotes(sentences(article.body)), article);
}

// "Leg het makkelijker uit": dezelfde kern, maar de korte zinnen eruit. Blijft vooraan in
// het bericht, want daar staat het belangrijkste. Korter is het enige dat deze terugval
// kan; echt herschrijven doet Gemini.
function simplerAnswer(article: Article): AnchorReply {
  const opening = withoutQuotes(sentences(article.body)).slice(0, 6);
  const easy = opening.filter((s) => words(s).length <= SIMPLE_WORDS).slice(0, 2);
  return reply(easy.length ? easy : opening.slice(0, 1), article, 'Is het zo duidelijk?');
}

// "Wat betekent dit?": zinnen die iets uitleggen of duiden. Staat dat er niet, dan zegt
// Nova dat eerlijk in plaats van zelf uitleg te verzinnen.
const EXPLAINS = /\b(betekent|betekenis|dat is|dit is|gaat om|komt doordat|omdat|daardoor|volgens)\b/i;

function meaningAnswer(article: Article): AnchorReply {
  const body = withoutQuotes(sentences(article.body));
  const explaining = body.slice(1).filter((s) => EXPLAINS.test(s));

  // Altijd eerst de openingszin: zonder die context hangt een uitleggende zin in de lucht.
  if (!explaining.length) {
    return { text: `${compose(body.slice(0, 1))} Meer uitleg geeft dit bericht niet. Wil je een ander onderwerp?`, articleId: article.id };
  }
  return reply([body[0], ...explaining], article, 'Wil je hier nog meer uitleg over?');
}

// "Waarom is dit belangrijk": de zinnen die de inzet concreet maken, meestal met een
// bedrag of een aantal. Geen aanname, alleen selectie. Slaat de openingszinnen over:
// die heeft de gebruiker net al gehoord.
function stakesAnswer(article: Article): AnchorReply {
  const rest = withoutQuotes(sentences(article.body)).slice(1);
  const withStakes = fitting(rest).filter((s) => /\d/.test(s));
  return reply(withStakes.length ? withStakes : rest, article, 'Wil je het volgende onderwerp horen?');
}

function sentenceAnswer(qWords: string[], article: Article): AnchorReply {
  const matches = withoutQuotes(sentences(article.body))
    .map((s, i) => ({ s, i, score: scoreText(qWords, s) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SENTENCES)
    .sort((a, b) => a.i - b.i)
    .map((m) => m.s);
  return reply(matches, article);
}

function notCovered(articles: Article[]): AnchorReply {
  const topics = [...new Set(articles.slice(0, OPENING_COUNT).map((a) => a.topic))].join(', ');
  return { text: `Daar heb ik nu geen bericht over. Vandaag gaat het over: ${topics}. Waar wil je meer over weten?`, articleId: null };
}

const ORDINALS: [RegExp, number][] = [
  [/\b(eerste|first|verhaal ?1|story ?1)\b/, 0],
  [/\b(tweede|second|verhaal ?2|story ?2)\b/, 1],
  [/\b(derde|third|verhaal ?3|story ?3)\b/, 2],
  [/\b(vierde|fourth|verhaal ?4|story ?4)\b/, 3],
  [/\b(vijfde|fifth|verhaal ?5|story ?5)\b/, 4],
];

const LAST = /\b(laatste|last)\b/;
const NEXT = /\b(volgende|next)\b/;
const PREVIOUS = /\b(vorige|previous|terug|back)\b/;
const SIMPLER = /\b(makkelijker|eenvoudiger|simpeler|snap het niet|begrijp het niet|simpler|easier)\b/;
const MEANING = /\b(wat betekent|betekent dit|betekent dat|wat houdt|what does.*mean)\b/;
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

// Bij het laden van de pagina: de eerste drie berichten kort introduceren, net als de
// opening van Gemini. `articleId` blijft leeg omdat de opening over drie berichten gaat;
// de interface toont dan die drie bronnen en nog geen actief onderwerp.
export function briefing(articles: Article[]): AnchorReply {
  const opening = articles.slice(0, OPENING_COUNT);
  const parts = opening.map((a, i) => {
    const cue = i === 0 ? 'Eerst' : i === opening.length - 1 ? 'Tot slot' : 'Dan';
    return `${cue}: ${shorten(a.title)}.`;
  });
  return { text: `Drie berichten van vandaag. ${parts.join(' ')} Waar wil je meer over weten?`, articleId: null };
}

export function respond(question: string, articles: Article[], activeIndex: number | null): AnchorReply {
  const q = question.toLowerCase();
  // Na de opening is er nog geen actief bericht. "Dit" en de snelle acties gaan dan over
  // het eerste bericht: dat noemde Nova als eerste.
  const focus = articles[activeIndex ?? 0];

  const ordinal = ORDINALS.find(([re, i]) => re.test(q) && articles[i]);
  if (ordinal) return storyIntro(articles[ordinal[1]]);
  if (LAST.test(q)) return storyIntro(articles[articles.length - 1]);

  if (NEXT.test(q)) {
    const next = (activeIndex ?? -1) + 1;
    if (next >= articles.length) {
      return { text: 'Dit was het laatste bericht van vandaag. Vraag gerust door, of ga terug naar een eerder bericht.', articleId: articles[articles.length - 1].id };
    }
    return storyIntro(articles[next]);
  }
  if (PREVIOUS.test(q)) return storyIntro(articles[Math.max((activeIndex ?? 1) - 1, 0)]);

  if (CATALOG.test(q)) {
    const byTopic = matchByTopic(q, articles);
    return byTopic ? storyIntro(byTopic) : notCovered(articles);
  }

  if (SIMPLER.test(q)) return simplerAnswer(focus);
  if (MEANING.test(q)) return meaningAnswer(focus);
  if (STAKES.test(q)) return stakesAnswer(focus);

  const qWords = keywords(question);
  const best = articles
    .map((a, i) => ({ i, score: scoreText(qWords, `${a.title} ${a.topic} ${a.body}`) }))
    .sort((a, b) => b.score - a.score)[0];

  // Naar een ánder bericht springen mag alleen bij twee rakende woorden. Eén woord is
  // vaak toeval, en dan antwoordt Nova over het verkeerde onderwerp.
  if (best.score >= (best.i === activeIndex ? 1 : 2)) return sentenceAnswer(qWords, articles[best.i]);
  if (activeIndex !== null) return notInArticle(focus);
  return notCovered(articles);
}
