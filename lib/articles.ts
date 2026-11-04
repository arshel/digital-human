import { createHash } from 'node:crypto';
import evalContext from '../evaluation/context.nl.json';
import testSet from '../data/test-articles.json';
import type { Region } from './feeds';
import { getStories, seenArticle, type Article } from './news';

// Welke berichten Nova vertelt. Alleen server-side: de brontekst en de hulpnotities gaan naar
// Gemini, de browser krijgt alleen de gegevens voor titel en bron (ArticleMeta).
//
// NEWS_MODE=test (standaard): de vaste testselectie uit data/test-articles.json, zodat elke
// deelnemer aan de gebruikerstest dezelfde berichten krijgt. NEWS_MODE=live: de actuele
// NOS-feeds Binnenland en Politiek (lib/news.ts, lib/feeds.ts): Nederlands nieuws.

export type NewsArticle = {
  id: string;
  shortTitle: string;
  title: string;
  publisher: string;
  url: string;
  published: string;
  updated: string | null;
  retrieved: string | null;
  body: string;
  // Afbeelding uit de feed, alleen voor in beeld. Gaat niet naar het taalmodel.
  image: string | null;
  // Nederlands nieuws, of buitenlands nieuws: dat laatste alleen voor vragen, niet in de lijst.
  region: Region;
  // Redactionele hulpnotities, alleen in de testselectie. Bij verschil geldt de brontekst.
  keyFacts: string[];
  conditions: string[];
  uncertainties: string[];
  // Hash van alles wat naar het model gaat: zo is na te gaan waarop een antwoord was gebaseerd.
  version: string;
};

export type ArticleMeta = Pick<
  NewsArticle,
  'id' | 'shortTitle' | 'title' | 'publisher' | 'url' | 'published' | 'updated' | 'version' | 'image' | 'region'
>;

export type NewsMode = 'test' | 'live' | 'eval';

// NEWS_MODE=eval: de vier vaste, verzonnen berichten uit evaluation/context.nl.json, met de juiste
// regio en van vandaag. Alleen om de vragenset af te spelen (scripts/evaluate-questions.mjs).
export const NEWS_MODE: NewsMode =
  process.env.NEWS_MODE === 'live' ? 'live' : process.env.NEWS_MODE === 'eval' ? 'eval' : 'test';

type Draft = Omit<NewsArticle, 'version'>;

function versioned(a: Draft): NewsArticle {
  const hash = createHash('sha256')
    .update(JSON.stringify([a.title, a.body, a.keyFacts, a.conditions, a.uncertainties, a.updated]))
    .digest('hex');
  return { ...a, version: hash.slice(0, 12) };
}

// Een afbeelding is optioneel in de testselectie: zet er "image": "https://…" bij als je die wilt tonen.
type TestDraft = Omit<Draft, 'image' | 'region'> & { image?: string | null };
const TEST_ARTICLES: NewsArticle[] = (testSet.articles as TestDraft[]).map((a) => versioned({ ...a, image: a.image ?? null, region: 'nl' }));

export function meta(a: NewsArticle): ArticleMeta {
  const { id, shortTitle, title, publisher, url, published, updated, version, image, region } = a;
  return { id, shortTitle, title, publisher, url, published, updated, version, image, region };
}

// live is false als de NOS-feed niet bereikbaar was: dan zijn het de verzonnen demo-artikelen
// uit data/articles.json, en die tonen we niet als nieuws.
function evalArticles(now = Date.now()): NewsArticle[] {
  return (evalContext as { id: string; title: string; region: string; body: string }[]).map((a, i) =>
    versioned({
      id: a.id,
      shortTitle: a.title,
      title: a.title,
      publisher: 'NOS',
      url: 'https://nos.nl/',
      // Allemaal van het afgelopen uur, het eerste het nieuwst.
      published: new Date(now - (i + 1) * 5 * 60 * 1000).toISOString(),
      updated: null,
      retrieved: null,
      body: a.body,
      image: null,
      region: a.region === 'buitenland' ? 'buitenland' : 'nl',
      keyFacts: [],
      conditions: [],
      uncertainties: [],
    }),
  );
}

function fromFeed(s: Article): NewsArticle {
  return versioned({
    id: s.id,
    shortTitle: s.title,
    title: s.title,
    publisher: s.source,
    url: s.sourceUrl,
    published: s.published,
    updated: null,
    retrieved: null,
    body: s.body,
    image: s.image,
    region: s.region,
    keyFacts: [],
    conditions: [],
    uncertainties: [],
  });
}

export async function getArticles(): Promise<{ articles: NewsArticle[]; live: boolean }> {
  if (NEWS_MODE === 'test') return { articles: TEST_ARTICLES, live: true };
  if (NEWS_MODE === 'eval') return { articles: evalArticles(), live: true };

  const { stories, live } = await getStories();
  return { live, articles: stories.map(fromFeed) };
}

// Ook een bericht dat intussen uit de feed is, maar dat de server eerder liet zien (lib/news.ts):
// dan kan iemand nog doorvragen over het bericht in beeld.
export async function findArticle(id: string) {
  const { articles, live } = await getArticles();
  if (!live) return null;
  const article = articles.find((a) => a.id === id);
  if (article) return article;
  const seen = NEWS_MODE === 'live' ? seenArticle(id) : null;
  return seen ? fromFeed(seen) : null;
}
