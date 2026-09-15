import demoArticles from '@/data/articles.json';

export type Article = {
  id: string;
  title: string;
  source: string;
  sourceUrl: string;
  published: string;
  topic: string;
  body: string;
};

export type StorySet = { stories: Article[]; live: boolean };

const FEED_URL = 'https://feeds.nos.nl/nosnieuwsalgemeen';
const FEED_SOURCE = 'NOS';
const CACHE_MS = 15 * 60 * 1000;
const FAILED_CACHE_MS = 60 * 1000;
const MAX_BODY = 6000;

// Alleen server-side: haalt de NOS-feed op en houdt die 15 minuten vast, zodat de
// verhalen niet midden in een gesprek verschuiven. Mislukt de feed, dan de demo-artikelen.
let cache: { at: number; ttl: number; pool: Article[]; live: boolean } | null = null;

const ENTITIES: Record<string, string> = {
  nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>',
  eacute: 'é', egrave: 'è', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü', auml: 'ä', ccedil: 'ç',
  hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', euro: '€',
};

function decode(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? m)
    .replace(/&amp;/g, '&');
}

// Feedtekst naar platte alinea's. Werkt voor CDATA en voor HTML als entities.
function plain(raw: string) {
  const html = decode(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
  return decode(
    html
      .replace(/<(script|style|figure|iframe)[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(p|h\d|li|blockquote|div)>|<br\s*\/?>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

function tag(xml: string, name: string) {
  return xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))?.[1] ?? '';
}

export function parseFeed(xml: string, source: string): Article[] {
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].flatMap(([item]) => {
    const title = plain(tag(item, 'title'));
    const link = plain(tag(item, 'link'));
    const date = new Date(plain(tag(item, 'pubDate')));
    const body = plain(tag(item, 'content:encoded') || tag(item, 'description')).slice(0, MAX_BODY);
    if (!title || !link || !body || isNaN(date.getTime())) return [];

    const slug = (plain(tag(item, 'guid')) || link).split(/[/?#]/).filter(Boolean).pop() ?? link;
    return [{
      id: slug.replace(/[^a-z0-9-]/gi, '').slice(0, 60) || String(date.getTime()),
      title,
      source,
      sourceUrl: link,
      published: date.toISOString(),
      topic: plain(tag(item, 'category')) || 'Nieuws',
      body,
    }];
  });
}

async function loadPool() {
  if (cache && Date.now() - cache.at < cache.ttl) return cache;

  try {
    const res = await fetch(FEED_URL, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const pool = parseFeed(await res.text(), FEED_SOURCE);
    if (pool.length === 0) throw new Error('feed bevat geen bruikbare berichten');
    cache = { at: Date.now(), ttl: CACHE_MS, pool, live: true };
  } catch (err) {
    console.error('[news] NOS-feed niet gebruikt, terugval op demo-artikelen:', err);
    cache = { at: Date.now(), ttl: FAILED_CACHE_MS, pool: demoArticles, live: false };
  }
  return cache;
}

// Zoveel verhalen noemt de opening. De rest van de feed staat erachter, zodat je
// ook naar ander nieuws kunt vragen.
export const OPENING_COUNT = 3;

// Alle berichten uit de feed. Vooraan de drie voor de opening: de nieuwste, met voorkeur
// voor berichten met genoeg tekst om over door te vragen. Daarna de rest, nieuwste eerst.
// Met `ids` (van de client) blijft een lopend gesprek bij dezelfde nummering; berichten
// die sindsdien in de feed zijn gekomen, sluiten achteraan aan.
export async function getStories(ids?: string[]): Promise<StorySet> {
  const { pool, live } = await loadPool();
  const recent = [...pool].sort((a, b) => b.published.localeCompare(a.published));

  if (ids?.length) {
    const kept = ids.flatMap((id) => pool.filter((a) => a.id === id));
    if (kept.length > 0) return { stories: [...kept, ...recent.filter((a) => !kept.includes(a))], live };
  }

  const rich = recent.slice(0, 12).filter((a) => a.body.length >= 400);
  const opening = [...rich, ...recent.filter((a) => !rich.includes(a))].slice(0, OPENING_COUNT);
  return { stories: [...opening, ...recent.filter((a) => !opening.includes(a))], live };
}
