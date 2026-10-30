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

export const OTHER_STORY = 'Dat gaat over een ander bericht van vandaag.';
export const NOT_FOUND = 'Ik vond het ook niet in het andere Nederlandse nieuws van vandaag.';

export type Candidate = { id: string; title: string; opening: string };

type Answer = { spoken: string; mode: 'ai' | 'fallback'; aboutArticle?: boolean; attempts: unknown[] };

export type QuestionDeps<A extends Answer> = {
  // De vraag beantwoorden uit één bericht.
  answer: (article: NewsArticle, previous: Previous[]) => Promise<A>;
  // Over welk bericht gaat de vraag? Een id uit de lijst, of null.
  route: (candidates: Candidate[]) => Promise<{ id: string | null; attempts: unknown[] }>;
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

// Het antwoord van het model op de routeervraag: alleen een id die echt in de lijst staat.
export function pickRoute(text: string, list: Candidate[]): string | null {
  try {
    const id = JSON.parse(text)?.id;
    return typeof id === 'string' && list.some((c) => c.id === id) ? id : null;
  } catch {
    return null;
  }
}

export async function answerQuestion<A extends Answer>(
  current: NewsArticle,
  previous: Previous[],
  articles: NewsArticle[],
  deps: QuestionDeps<A>,
): Promise<{ article: NewsArticle; answer: A; switchedFrom: string | null }> {
  const first = await deps.answer(current, previous);
  const stay = { article: current, answer: first, switchedFrom: null };
  if (first.mode !== 'ai' || first.aboutArticle !== false) return stay;

  const list = candidates(articles, current.id);
  if (!list.length) return stay;
  const routed = await deps.route(list).catch(() => null);
  if (!routed) return stay;
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
  };
}
