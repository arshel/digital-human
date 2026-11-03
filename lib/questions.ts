import type { NewsArticle } from './articles';
import type { Previous } from './prompt';

// Een vraag over ander nieuws van vandaag. Nova vertelt nog steeds alleen uit een bron: niet
// alleen uit het bericht in beeld, maar uit het bericht waar de vraag over gaat.
//
// 1. Nova beantwoordt de vraag uit het bericht in beeld, en meldt of de vraag daarover ging
//    (aboutArticle). Voor gewone vragen kost dit dus niets extra.
// 2. Ging hij er niet over: het taalmodel kiest uit de berichten van vandaag (titel en begin)
//    het bericht waar de vraag over gaat, of geen.
// 3. Gevonden: Nova beantwoordt de vraag uit dát bericht, en zegt eerst dat het om een ander
//    bericht gaat. De pagina gaat dan naar dat bericht, zodat bron en datum kloppen.
//    Niets gevonden: het eerste, eerlijke antwoord, plus dat het ook niet in het andere
//    (Nederlandse) nieuws van vandaag staat. Iets onzeker (zoeken mislukt, keuze klopt niet): het eerste antwoord.
//
// Een algemene vraag ("Wat gebeurde er vandaag?", "Wat is er nog meer?") gaat over geen enkel
// bericht. Die krijgt een kort overzicht van de nieuwste berichten. In de demo van 3 november 2026
// gaf Nova op zo'n vraag het bericht in beeld nog een keer. Herkend vóór het taalmodel
// (isOverviewQuestion), en anders kan de routeervraag het nog als overzicht aanwijzen.

export const OTHER_STORY = 'Dat gaat over een ander bericht van vandaag.';
export const NOT_FOUND = 'Ik vond het ook niet in het andere Nederlandse nieuws van vandaag.';

export type Candidate = { id: string; title: string; opening: string };

// Wat de routeervraag teruggeeft voor een algemene vraag over het nieuws.
export const OVERVIEW = 'overzicht';

// Woorden die in een algemene vraag over het nieuws voorkomen. Staat er een ander woord in
// ("Wat gebeurde er vandaag met de boeren?"), dan gaat de vraag over een onderwerp.
const OVERVIEW_WORDS = new Set(
  `wat welk welke is was er zijn het de een in van op nog meer verder anders ander andere allemaal
  vandaag nu vanochtend vanmiddag vanavond gisteren laatste nieuwste belangrijkste
  nieuws nieuwtjes berichten onderwerpen overzicht hoofdpunten koppen
  gebeurd gebeurde gebeurt gebeuren gaande speelt
  vertel geef noem me mij ons kun kan je jij u eens even dan en dus oké ok oke nou hé he hoi nova eigenlijk
  nederland binnenland politiek`.split(/\s+/),
);
// Een van deze woorden maakt het een vraag over het nieuws. "meer", "verder" en "anders" alleen
// met "wat ... er": "Wat is er nog meer?" wel, "Vertel me meer" (over dit bericht) niet.
const OVERVIEW_TOPIC = /\b(vandaag|nieuws|nieuwtjes|berichten|onderwerpen|overzicht|hoofdpunten|koppen)\b/;
const OVERVIEW_MORE = /\b(meer|verder|anders|andere?)\b/;

export function isOverviewQuestion(question: string) {
  const text = question.toLowerCase().replace(/[^a-zà-ÿ\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text.split(' ').filter(Boolean);
  if (!words.length || !words.every((w) => OVERVIEW_WORDS.has(w))) return false;
  if (OVERVIEW_TOPIC.test(text)) return true;
  return OVERVIEW_MORE.test(text) && words.includes('wat') && words.includes('er');
}

// De berichten voor het overzicht: de eerste van de lijst (de opening, daarna de nieuwste).
const OVERVIEW_COUNT = 5;

export function overviewStories<T>(articles: T[]): T[] {
  return articles.slice(0, OVERVIEW_COUNT);
}

type Answer = { spoken: string; mode: 'ai' | 'fallback'; aboutArticle?: boolean; attempts: unknown[] };

export type QuestionDeps<A extends Answer> = {
  // De vraag beantwoorden uit één bericht.
  answer: (article: NewsArticle, previous: Previous[]) => Promise<A>;
  // Over welk bericht gaat de vraag? Een id uit de lijst, OVERVIEW, of null.
  route: (candidates: Candidate[]) => Promise<{ id: string | null; attempts: unknown[] }>;
  // Een kort overzicht van het nieuws, voor een algemene vraag.
  overview: () => Promise<A>;
};

// Alle berichten van vandaag (Binnenland en Politiek samen zijn er zo'n 40), elk kort: titel en
// begin. Een te krappe grens liet een bericht verderop in de lijst buiten beeld.
const MAX_CANDIDATES = 60;

export function candidates(articles: NewsArticle[], currentId: string): Candidate[] {
  return articles
    .filter((a) => a.id !== currentId)
    .slice(0, MAX_CANDIDATES)
    .map((a) => ({ id: a.id, title: a.title, opening: a.body.replace(/\s+/g, ' ').slice(0, 110) }));
}

// Het antwoord van het model op de routeervraag: alleen een id die echt in de lijst staat, of
// OVERVIEW.
export function pickRoute(text: string, list: Candidate[]): string | null {
  try {
    const id = JSON.parse(text)?.id;
    if (id === OVERVIEW) return OVERVIEW;
    return typeof id === 'string' && list.some((c) => c.id === id) ? id : null;
  } catch {
    return null;
  }
}

export async function answerQuestion<A extends Answer>(
  current: NewsArticle,
  question: string,
  previous: Previous[],
  articles: NewsArticle[],
  deps: QuestionDeps<A>,
): Promise<{ article: NewsArticle; answer: A; switchedFrom: string | null; overview: boolean }> {
  // Het bericht in beeld blijft staan: het overzicht hoort bij geen enkel bericht in het bijzonder.
  if (isOverviewQuestion(question)) return { article: current, answer: await deps.overview(), switchedFrom: null, overview: true };

  const first = await deps.answer(current, previous);
  const stay = { article: current, answer: first, switchedFrom: null, overview: false };
  if (first.mode !== 'ai' || first.aboutArticle !== false) return stay;

  const list = candidates(articles, current.id);
  if (!list.length) return stay;
  const routed = await deps.route(list).catch(() => null);
  if (!routed) return stay;
  if (routed.id === OVERVIEW) {
    const overview = await deps.overview();
    return {
      ...stay,
      answer: { ...overview, attempts: [...first.attempts, ...routed.attempts, ...overview.attempts] },
      overview: true,
    };
  }
  const other = routed.id ? articles.find((a) => a.id === routed.id && a.id !== current.id) : undefined;
  if (!other) return { ...stay, answer: { ...first, spoken: `${first.spoken} ${NOT_FOUND}` } };

  const second = await deps.answer(other, []);
  // Zegt ook dat bericht dat de vraag er niet over gaat, dan klopte de keuze niet.
  if (second.mode !== 'ai' || second.aboutArticle === false) return stay;
  return {
    article: other,
    answer: {
      ...second,
      spoken: `${OTHER_STORY} ${second.spoken}`,
      attempts: [...first.attempts, ...routed.attempts, ...second.attempts],
    },
    switchedFrom: current.id,
    overview: false,
  };
}
