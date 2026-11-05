import type { NewsArticle } from './articles';
import type { Region } from './feeds';
import type { Previous } from './prompt';

// Een vraag van de gebruiker. Eerst één beslissing: wat voor vraag is dit? Een taalmodel kiest uit
// een vaste lijst (Beslissing) en geeft JSON terug; de code controleert die streng (parseBeslissing).
// Daarna doet gewone code de rest: welk bericht, welke berichten in een overzicht, welke datum.
// Het antwoord zelf komt altijd uit één bericht, of uit de titels en het begin bij een overzicht.
//
// Waarom zo: tot 4 november 2026 besliste een keten van woordenlijst, een vlag in het antwoord,
// zoeken op de antwoordtekst en een zoekaanroep. Die gaven samen steeds nieuwe fouten ("geen nieuws
// over nieuws", het Nederlandse overzicht bij "wat is het Congres"). Zie
// reports/nova-vragen-review-2026-11-04.md.
//
// Bij twijfel of een fout antwoordt Nova uit het bericht in beeld. "Geen nieuws over …" zegt Nova
// alleen als het model dat koos én het onderwerp nergens in de berichten voorkomt.

export type Dag = 'vandaag' | 'gisteren';

export type Beslissing =
  | { soort: 'dit_bericht' }
  | { soort: 'begrip'; begrip: string | null }
  | { soort: 'ander_bericht'; id: string }
  | { soort: 'overzicht'; regio: Region; minuten: number | null; dag: Dag | null }
  | { soort: 'geen_match'; onderwerp: string | null }
  | { soort: 'onzeker' };

export type Soort = Beslissing['soort'];
export const SOORTEN: Soort[] = ['dit_bericht', 'begrip', 'ander_bericht', 'overzicht', 'geen_match', 'onzeker'];

// Een beslissing, of een technische fout (geen JSON, onbekende soort, id niet in de lijst). Een fout
// is iets anders dan "geen nieuws": dan antwoordt Nova gewoon uit het bericht in beeld.
export type Classification = { beslissing: Beslissing } | { fout: string };

const MAX_MINUTES = 24 * 60;

// Kort onderwerp om uit te spreken ("Gaza", "de stikstofwet"): alleen gewone tekens. Anders null.
export function cleanTopic(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  if (!clean || clean.length > 40 || clean.split(' ').length > 5) return null;
  return /^[\p{L}\p{N} '’-]+$/u.test(clean) ? clean : null;
}

export function parseBeslissing(text: string, ids: Set<string>): Classification {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    return { fout: 'geen json' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { fout: 'geen object' };
  const soort = data.soort;
  switch (soort) {
    case 'dit_bericht':
    case 'onzeker':
      return { beslissing: { soort } };
    case 'begrip':
      return { beslissing: { soort, begrip: cleanTopic(data.begrip) } };
    case 'ander_bericht':
      return typeof data.id === 'string' && ids.has(data.id)
        ? { beslissing: { soort, id: data.id } }
        : { fout: 'id niet in de lijst' };
    case 'overzicht': {
      const regio = data.regio ?? 'nl';
      if (regio !== 'nl' && regio !== 'buitenland') return { fout: 'onbekende regio' };
      const minuten = data.minuten ?? null;
      if (minuten !== null && !(Number.isInteger(minuten) && (minuten as number) >= 1 && (minuten as number) <= MAX_MINUTES)) {
        return { fout: 'ongeldig tijdvak' };
      }
      const dag = data.dag ?? null;
      if (dag !== null && dag !== 'vandaag' && dag !== 'gisteren') return { fout: 'onbekende dag' };
      return { beslissing: { soort, regio, minuten: minuten as number | null, dag: minuten === null ? (dag as Dag | null) : null } };
    }
    case 'geen_match':
      return { beslissing: { soort, onderwerp: cleanTopic(data.onderwerp) } };
    default:
      return { fout: 'onbekende soort' };
  }
}

// ---------- tijd ----------

// "2026-11-04" in Nederlandse tijd. Een ongeldige datum geeft een lege tekst: dat is nooit vandaag.
export function amsterdamDay(ms: number) {
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' }) : '';
}

function yesterday(now: number) {
  return amsterdamDay(Date.parse(`${amsterdamDay(now)}T12:00:00Z`) - 24 * 60 * 60 * 1000);
}

export function isToday(iso: string, now = Date.now()) {
  const day = amsterdamDay(Date.parse(iso));
  return day !== '' && day === amsterdamDay(now);
}

// "14.32", in Nederlandse tijd: zo leest de stem het als een tijd.
export function clock(iso: string) {
  return new Date(iso)
    .toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' })
    .replace(':', '.');
}

// Voor de lijst in de classificatievraag: "vandaag 14.32", "gisteren 20.10", "2 nov".
export function when(iso: string, now = Date.now()) {
  if (!Number.isFinite(Date.parse(iso))) return 'onbekend';
  const day = amsterdamDay(Date.parse(iso));
  if (day === amsterdamDay(now)) return `vandaag ${clock(iso)}`;
  if (day === yesterday(now)) return `gisteren ${clock(iso)}`;
  return new Date(iso).toLocaleDateString('nl-NL', { timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'short' });
}

// Hoe Nova een tijdvak noemt: "in de afgelopen 10 minuten" / "van de afgelopen 10 minuten".
export type Period = { in: string; of: string };

export function minutesPeriod(minutes: number): Period {
  if (minutes === 60) return { in: 'in het afgelopen uur', of: 'van het afgelopen uur' };
  const span = minutes % 60 === 0 ? `${minutes / 60} uur` : minutes === 1 ? 'minuut' : `${minutes} minuten`;
  return { in: `in de afgelopen ${span}`, of: `van de afgelopen ${span}` };
}

// ---------- berichten kiezen ----------

export function inRegion<T extends { region?: Region }>(articles: T[], region: Region): T[] {
  return articles.filter((a) => (a.region ?? 'nl') === region);
}

function newestFirst<T extends { published: string }>(list: T[]) {
  return [...list].sort((a, b) => b.published.localeCompare(a.published));
}

const OVERVIEW_COUNT = 5;
// Een minuut speling voor klokverschil met de NOS. Wat daarna gepubliceerd lijkt, telt niet mee.
const CLOCK_SLACK = 60 * 1000;

// Berichten uit het tijdvak, nieuwste eerst. Nooit iets uit de toekomst.
export function recentStories<T extends { published: string }>(articles: T[], minutes: number, now = Date.now()): T[] {
  const since = now - minutes * 60 * 1000;
  return newestFirst(
    articles.filter((a) => {
      const t = Date.parse(a.published);
      return t >= since && t <= now + CLOCK_SLACK;
    }),
  ).slice(0, OVERVIEW_COUNT);
}

// Wat er in een overzicht komt, en hoe Nova het tijdvak noemt. `period` is undefined bij "het
// nieuwste nieuws". Bij "vandaag" met minder dan 3 berichten (vroeg op de dag): het nieuwste nieuws.
export function overviewSelection<T extends { published: string; region?: Region }>(
  articles: T[],
  b: Extract<Beslissing, { soort: 'overzicht' }>,
  now = Date.now(),
): { stories: T[]; period?: Period; day?: Dag } {
  const pool = inRegion(articles, b.regio).filter((a) => Date.parse(a.published) <= now + CLOCK_SLACK);
  if (b.minuten) return { stories: recentStories(pool, b.minuten, now), period: minutesPeriod(b.minuten) };
  if (b.dag === 'gisteren') {
    const day = yesterday(now);
    const stories = newestFirst(pool.filter((a) => amsterdamDay(Date.parse(a.published)) === day)).slice(0, OVERVIEW_COUNT);
    return { stories, period: { in: 'gisteren', of: 'van gisteren' }, day: 'gisteren' };
  }
  if (b.dag === 'vandaag') {
    const today = newestFirst(pool.filter((a) => isToday(a.published, now)));
    if (today.length >= 3) return { stories: today.slice(0, OVERVIEW_COUNT), period: { in: 'vandaag', of: 'van vandaag' }, day: 'vandaag' };
  }
  return { stories: newestFirst(pool).slice(0, OVERVIEW_COUNT) };
}

// ---------- vaste zinnen ----------

export function sentence(title: string) {
  return /[.!?]$/.test(title) ? title : `${title}.`;
}

// Bij een wissel naar een ander bericht. "van vandaag" alleen als het bericht van vandaag is.
export function announce(article: { region?: Region; published: string }, now = Date.now()) {
  const today = isToday(article.published, now) ? ' van vandaag' : '';
  return article.region === 'buitenland' ? `Dat gaat over buitenlands nieuws${today}.` : `Dat gaat over een ander bericht${today}.`;
}

export function noNews(topic: string | null) {
  return topic ? `Ik heb vandaag geen nieuws over ${topic}.` : 'Daar heb ik vandaag geen nieuws over.';
}

// Een overzicht zonder berichten. Vaste zinnen en letterlijk een titel: geen taalmodel nodig.
export function emptyOverview(
  all: { title: string; publisher: string; published: string }[],
  region: Region,
  sel: { period?: Period; day?: Dag },
) {
  const kind = region === 'buitenland' ? 'buitenlands bericht' : 'bericht';
  // Nova heeft alleen de nieuwste berichten uit de feed: over gisteren kan er dus meer zijn geweest.
  if (sel.day === 'gisteren') return `Ik heb geen ${kind} van gisteren. Ik heb alleen de nieuwste berichten van de NOS.`;
  const latest = newestFirst(all)[0];
  const when = sel.period?.in ?? 'nu';
  const start = `${when.charAt(0).toUpperCase()}${when.slice(1)} is er geen nieuw ${kind} gekomen.`;
  return latest ? `${start} Het nieuwste ${kind} kwam om ${clock(latest.published)} uur: ${sentence(latest.title)}` : start;
}

// ---------- de vraag ----------

export type Candidate = { id: string; title: string; region: Region; when: string; opening: string };

// Alle andere berichten (Nederlands en buitenland samen zijn er zo'n 55), kort: titel, regio, tijd
// en begin. Dat is genoeg om te kiezen; het antwoord komt daarna uit het hele bericht.
const MAX_CANDIDATES = 90;

export function candidates(articles: NewsArticle[], currentId: string, now = Date.now()): Candidate[] {
  return articles
    .filter((a) => a.id !== currentId)
    .slice(0, MAX_CANDIDATES)
    .map((a) => ({
      id: a.id,
      title: a.title,
      region: a.region ?? 'nl',
      when: when(a.published, now),
      opening: a.body.replace(/\s+/g, ' ').slice(0, 90),
    }));
}

// Staat het onderwerp toch in een bericht? Dan zegt Nova niet "geen nieuws": het model kan een
// bericht gemist hebben. Alle woorden van 4 letters of meer moeten in hetzelfde bericht staan:
// "verkiezingen in Bhutan" telt niet omdat er een bericht over andere verkiezingen is.
export function topicMentioned(topic: string | null, articles: { title: string; body: string }[]) {
  const words = (topic ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
  if (!words.length) return false;
  return articles.some((a) => {
    const text = `${a.title} ${a.body}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

type Answer = { spoken: string; mode: 'ai' | 'fallback'; attempts: unknown[] };

export type QuestionDeps<A extends Answer> = {
  // De beslissing. Gooit niet: een fout komt terug als { fout }.
  classify: (list: Candidate[]) => Promise<{ result: Classification; attempts: unknown[] }>;
  // De vraag beantwoorden uit één bericht.
  answer: (article: NewsArticle, previous: Previous[]) => Promise<A>;
  // Een kort overzicht van deze berichten.
  overview: (stories: NewsArticle[], period: Period | undefined) => Promise<A>;
  // Een vaste zin, zonder taalmodel.
  fixed: (spoken: string) => A;
};

export type QuestionResult<A> = {
  article: NewsArticle;
  answer: A;
  switchedFrom: string | null;
  overview: boolean;
  // Wat er besloten is, voor de metingen (geen tekst): een soort, of "fout".
  decision: Soort | 'fout';
};

export async function answerQuestion<A extends Answer>(
  current: NewsArticle,
  previous: Previous[],
  articles: NewsArticle[],
  deps: QuestionDeps<A>,
  now = Date.now(),
): Promise<QuestionResult<A>> {
  const list = candidates(articles, current.id, now);
  const classified = await deps.classify(list).catch((err) => ({
    result: { fout: err instanceof Error ? err.message : String(err) } as Classification,
    attempts: [] as unknown[],
  }));
  // Alle modelpogingen tellen mee in de metingen, ook die van de beslissing.
  const withAttempts = (answer: A): A => ({ ...answer, attempts: [...classified.attempts, ...answer.attempts] });
  const here = async (decision: QuestionResult<A>['decision']): Promise<QuestionResult<A>> => ({
    article: current,
    answer: withAttempts(await deps.answer(current, previous)),
    switchedFrom: null,
    overview: false,
    decision,
  });

  if ('fout' in classified.result) {
    console.error('[vraag] beslissing mislukt, antwoord uit het bericht in beeld:', classified.result.fout.slice(0, 300));
    return here('fout');
  }
  const b = classified.result.beslissing;
  switch (b.soort) {
    case 'dit_bericht':
    case 'begrip':
    case 'onzeker':
      return here(b.soort);
    case 'ander_bericht': {
      const other = articles.find((a) => a.id === b.id);
      if (!other || other.id === current.id) return here('dit_bericht');
      const answer = await deps.answer(other, []);
      return {
        article: other,
        answer: withAttempts({ ...answer, spoken: `${announce(other, now)} ${answer.spoken}` }),
        switchedFrom: current.id,
        overview: false,
        decision: b.soort,
      };
    }
    case 'overzicht': {
      const sel = overviewSelection(articles, b, now);
      const answer = sel.stories.length
        ? await deps.overview(sel.stories, sel.period)
        : deps.fixed(emptyOverview(inRegion(articles, b.regio), b.regio, sel));
      return { article: current, answer: withAttempts(answer), switchedFrom: null, overview: true, decision: b.soort };
    }
    case 'geen_match':
      // Staat het onderwerp toch ergens? Dan niet stellig "geen nieuws": antwoord uit dit bericht.
      if (topicMentioned(b.onderwerp, articles)) return here('onzeker');
      return { article: current, answer: withAttempts(deps.fixed(noNews(b.onderwerp))), switchedFrom: null, overview: false, decision: b.soort };
  }
}
