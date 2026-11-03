import { createHash } from 'node:crypto';
import testSet from '../data/test-articles.json';
import { getStories } from './news';

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
  // Redactionele hulpnotities, alleen in de testselectie. Bij verschil geldt de brontekst.
  keyFacts: string[];
  conditions: string[];
  uncertainties: string[];
  // Hash van alles wat naar het model gaat: zo is na te gaan waarop een antwoord was gebaseerd.
  version: string;
};

export type ArticleMeta = Pick<
  NewsArticle,
  'id' | 'shortTitle' | 'title' | 'publisher' | 'url' | 'published' | 'updated' | 'version' | 'image'
>;

export type NewsMode = 'test' | 'live';

export const NEWS_MODE: NewsMode = process.env.NEWS_MODE === 'live' ? 'live' : 'test';

type Draft = Omit<NewsArticle, 'version'>;

function versioned(a: Draft): NewsArticle {
  const hash = createHash('sha256')
    .update(JSON.stringify([a.title, a.body, a.keyFacts, a.conditions, a.uncertainties, a.updated]))
    .digest('hex');
  return { ...a, version: hash.slice(0, 12) };
}

// Een afbeelding is optioneel in de testselectie: zet er "image": "https://…" bij als je die wilt tonen.
type TestDraft = Omit<Draft, 'image'> & { image?: string | null };
const TEST_ARTICLES: NewsArticle[] = (testSet.articles as TestDraft[]).map((a) => versioned({ ...a, image: a.image ?? null }));

export function meta(a: NewsArticle): ArticleMeta {
  const { id, shortTitle, title, publisher, url, published, updated, version, image } = a;
  return { id, shortTitle, title, publisher, url, published, updated, version, image };
}

// live is false als de NOS-feed niet bereikbaar was: dan zijn het de verzonnen demo-artikelen
// uit data/articles.json, en die tonen we niet als nieuws.
export async function getArticles(): Promise<{ articles: NewsArticle[]; live: boolean }> {
  if (NEWS_MODE === 'test') return { articles: TEST_ARTICLES, live: true };

  const { stories, live } = await getStories();
  return {
    live,
    articles: stories.map((s) =>
      versioned({
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
        keyFacts: [],
        conditions: [],
        uncertainties: [],
      }),
    ),
  };
}

export async function findArticle(id: string) {
  const { articles, live } = await getArticles();
  const article = articles.find((a) => a.id === id);
  return article && live ? article : null;
}
