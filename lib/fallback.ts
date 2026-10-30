import type { NewsArticle } from './articles';
import type { Action } from './prompt';

// Terugval zonder taalmodel: regelgebaseerd. lib/ai.ts gebruikt dit als Gemini ontbreekt of
// faalt, zodat een test niet stilvalt. De interface meldt dat de terugval actief is.
//
// Alle woorden over het nieuws komen uit de brontekst: deze code kiest zinnen, gooit weg en
// knipt af, maar schrijft nooit feiten bij. Daardoor kan ze niets verzinnen, maar ook niet echt
// herschrijven. Dichter bij A2 komen we door kort te houden: hooguit drie zinnen, lange
// bronzinnen afgekapt bij een deelzin, en citaten alleen als er niets anders is. Alleen vaste
// zinnen zoals "Dat staat niet in dit bericht." komen niet uit de bron.

// Woorden te algemeen om een vraag op te matchen.
const STOPWORDS = new Set([
  'waarom', 'wanneer', 'welke', 'hierover', 'daarover', 'eigenlijk', 'gebeurt', 'wordt', 'worden',
  'hebben', 'heeft', 'zijn', 'deze', 'dit', 'voor', 'over', 'niet', 'nog', 'wat', 'wie', 'hoe', 'mij',
  'mijn', 'jij', 'jouw', 'ook', 'maar', 'kunnen', 'moet', 'moeten', 'gaat', 'gaan', 'komt', 'hoeveel',
  'waarvoor', 'waardoor', 'waarover', 'precies', 'vertel', 'uitleg', 'betekent', 'bericht', 'nieuws',
]);

const MAX_SENTENCE_WORDS = 18;
const SIMPLE_WORDS = 14;
const MAX_SENTENCES = 3;
const MAX_WORDS = 45;

// Komma of puntkomma voor een voegwoord: daar kun je een lange zin afkappen zonder dat het
// eerste deel een halve zin wordt.
const CLAUSE = /;\s+|,\s+(?=(?:en|maar|want|omdat|terwijl|zodat|hoewel|waardoor|waarbij|die|dat)\b)/gi;
const QUOTED = /["“”]/;
// Tussenkopjes uit de feed ("Klimaatschade", "Wat is NHG?") zijn geen zinnen.
const HEADING = /^[^.!?]{1,40}\??$/;

function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean);
}

export function sourceSentences(body: string) {
  return body
    .split(/\n\s*\n/)
    .filter((p) => !HEADING.test(p.trim()))
    .flatMap((p) => p.split(/(?<=[.!?]["”]?)\s+/))
    .map((s) => s.trim())
    .filter((s) => words(s).length >= 4);
}

// Lange bronzinnen veilig inkorten: liefst afkappen bij een deelzin, anders bij een heel woord
// met een beletselteken erachter, zodat zichtbaar is dat er meer stond.
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

// Zinnen die zonder afkappen passen gaan voor: een afgekapte zin leest slechter.
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

// Citaten zijn meestal de langste en moeilijkste zinnen. Ze vallen af zolang er gewone zinnen zijn.
function withoutQuotes(list: string[]) {
  const plain = list.filter((s) => !QUOTED.test(s));
  return plain.length ? plain : list;
}

function keywords(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9à-ÿ]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

// "Wat betekent dit?": zinnen die iets uitleggen of duiden.
const EXPLAINS = /\b(betekent|betekenis|dat is|dit is|staat voor|gaat om|komt doordat|omdat|daardoor|daarom|volgens)\b/i;

export function fallbackExplanation(article: NewsArticle, action: Action, question = '') {
  const all = sourceSentences(article.body);
  const plain = withoutQuotes(all);
  const credit = `Dat meldt de ${article.publisher}.`;

  switch (action) {
    case 'core':
      return `${compose(plain)} ${credit}`;
    case 'simpler': {
      const easy = plain.slice(0, 6).filter((s) => words(s).length <= SIMPLE_WORDS).slice(0, 2);
      return compose(easy.length ? easy : plain.slice(0, 1));
    }
    case 'meaning': {
      const explaining = plain.slice(1).filter((s) => EXPLAINS.test(s));
      if (!explaining.length) return `${compose(plain.slice(0, 1))} Meer uitleg staat niet in dit bericht.`;
      return compose(explaining);
    }
    case 'more': {
      // Overslaan wat de kern al zei: de eerste zinnen.
      const rest = plain.slice(4);
      return rest.length ? compose(rest) : 'Meer achtergrond staat niet in dit bericht.';
    }
    case 'question': {
      const asked = keywords(question);
      const matches = plain
        .map((s, i) => ({ s, i, score: keywords(s).filter((w) => asked.includes(w)).length }))
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_SENTENCES)
        .sort((a, b) => a.i - b.i)
        .map((m) => m.s);
      if (!matches.length) return `Dat staat niet in dit bericht. Het bericht gaat hierover: ${shorten(plain[0] ?? article.title)}`;
      return compose(matches);
    }
  }
}
