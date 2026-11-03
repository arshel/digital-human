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
  nederland binnenland politiek
  afgelopen voorbije vorige minuut minuten kwartier uur uren half halve paar binnengekomen nieuw nieuwe
  één twee drie vier vijf tien vijftien twintig dertig veertig vijftig zestig`.split(/\s+/),
);

// Een tijdvak in de vraag, in minuten: "de afgelopen 10 minuten", "het laatste half uur",
// "het afgelopen kwartier", "de laatste 2 uur". Geen tijdvak: null.
const COUNT: Record<string, number> = {
  een: 1, één: 1, twee: 2, drie: 3, vier: 4, vijf: 5, tien: 10, vijftien: 15, twintig: 20,
  dertig: 30, veertig: 40, vijftig: 50, zestig: 60, paar: 3, half: 0.5, halve: 0.5,
};
const WINDOW = /\b(?:afgelopen|laatste|voorbije|vorige)\s+(?:(\d+|[a-zé]+)\s+)?(minuut|minuten|kwartier|uur|uren)\b/;
const MAX_WINDOW = 24 * 60;

export function newsWindow(question: string): number | null {
  const m = question.toLowerCase().match(WINDOW);
  if (!m) return null;
  const [, amount, unit] = m;
  const n = amount === undefined ? 1 : /^\d+$/.test(amount) ? Number(amount) : COUNT[amount];
  if (!n) return null;
  const per = unit.startsWith('minu') ? (amount === 'paar' ? 10 / 3 : 1) : unit === 'kwartier' ? 15 : 60;
  return Math.min(MAX_WINDOW, Math.max(1, Math.round(n * per)));
}

// Berichten uit het tijdvak, nieuwste eerst.
export function recentStories<T extends { published: string }>(articles: T[], minutes: number, now = Date.now()): T[] {
  const since = now - minutes * 60 * 1000;
  return articles
    .filter((a) => Date.parse(a.published) >= since)
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, OVERVIEW_COUNT);
}
// Een van deze woorden maakt het een vraag over het nieuws. "meer", "verder" en "anders" alleen
// met "wat ... er": "Wat is er nog meer?" wel, "Vertel me meer" (over dit bericht) niet.
const OVERVIEW_TOPIC = /\b(vandaag|nieuws|nieuwtjes|berichten|onderwerpen|overzicht|hoofdpunten|koppen)\b/;
const OVERVIEW_MORE = /\b(meer|verder|anders|andere?)\b/;

export function isOverviewQuestion(question: string) {
  const text = question.toLowerCase().replace(/[^a-zà-ÿ0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text.split(' ').filter(Boolean);
  if (!words.length || !words.every((w) => OVERVIEW_WORDS.has(w) || /^\d+$/.test(w))) return false;
  if (OVERVIEW_TOPIC.test(text) || newsWindow(text) !== null) return true;
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
  // Een kort overzicht van het nieuws, voor een algemene vraag. Met een tijdvak in minuten als
  // de vraag daarom vroeg ("de afgelopen 10 minuten").
  overview: (minutes: number | null) => Promise<A>;
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
  if (isOverviewQuestion(question)) {
    return { article: current, answer: await deps.overview(newsWindow(question)), switchedFrom: null, overview: true };
  }

  const first = await deps.answer(current, previous);
  const stay = { article: current, answer: first, switchedFrom: null, overview: false };
  if (first.mode !== 'ai' || first.aboutArticle !== false) return stay;

  const list = candidates(articles, current.id);
  if (!list.length) return stay;
  const routed = await deps.route(list).catch(() => null);
  if (!routed) return stay;
  if (routed.id === OVERVIEW) {
    const overview = await deps.overview(newsWindow(question));
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

// ---------- het nieuws van een tijdvak ----------

export function sentence(title: string) {
  return /[.!?]$/.test(title) ? title : `${title}.`;
}

// "14.32", in Nederlandse tijd: zo leest de stem het als een tijd.
export function clock(iso: string) {
  return new Date(iso)
    .toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' })
    .replace(':', '.');
}

// "de afgelopen 10 minuten", "het afgelopen uur", "de afgelopen 2 uur".
export function periodLabel(minutes: number) {
  if (minutes === 60) return 'het afgelopen uur';
  if (minutes % 60 === 0) return `de afgelopen ${minutes / 60} uur`;
  if (minutes === 1) return 'de afgelopen minuut';
  return `de afgelopen ${minutes} minuten`;
}

// Niets nieuws in het tijdvak: dat eerlijk zeggen, plus het nieuwste bericht en hoe laat het kwam.
// Vaste zinnen en letterlijk de titel, dus zonder taalmodel.
export function noRecentNews(articles: { title: string; publisher: string; published: string }[], period: string) {
  const latest = [...articles].sort((a, b) => b.published.localeCompare(a.published))[0];
  if (!latest) return `In ${period} is er geen nieuw bericht gekomen.`;
  return `In ${period} is er geen nieuw bericht van de ${latest.publisher} gekomen. Het nieuwste bericht kwam om ${clock(latest.published)} uur: ${sentence(latest.title)}`;
}
