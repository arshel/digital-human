// Welke NOS-feeds Nova leest, en wat daarvan echt een nieuwsbericht is. Geen afhankelijkheden:
// ook bruikbaar in de tests.
//
// Nova vertelt over nieuws uit Nederland: standaard de feeds Binnenland en Politiek. Economie is
// gemengd (veel buitenlandse bedrijven) en Buitenland valt erbuiten. Anders instellen met
// NEWS_FEEDS, bijvoorbeeld NEWS_FEEDS=nosnieuwsbinnenland,nosnieuwspolitiek,nosnieuwseconomie.

export const DEFAULT_FEEDS = ['nosnieuwsbinnenland', 'nosnieuwspolitiek'];

// Buitenlands nieuws: niet in de opening of de lijst, alleen als iemand ernaar vraagt ("Wat is er
// vandaag in Amerika gaande?"). Anders instellen met NEWS_FOREIGN_FEEDS; NEWS_FOREIGN_FEEDS=uit
// zet het uit.
export const DEFAULT_FOREIGN_FEEDS = ['nosnieuwsbuitenland'];

export type Region = 'nl' | 'buitenland';

function slugs(setting: string) {
  return setting
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-z]+$/.test(s));
}

export function feedUrls(setting?: string) {
  const list = slugs(setting || DEFAULT_FEEDS.join(','));
  return (list.length ? list : DEFAULT_FEEDS).map((slug) => `https://feeds.nos.nl/${slug}`);
}

export function foreignFeedUrls(setting?: string) {
  if (setting?.trim() === 'uit') return [];
  const list = slugs(setting || DEFAULT_FOREIGN_FEEDS.join(','));
  return (list.length ? list : DEFAULT_FOREIGN_FEEDS).map((slug) => `https://feeds.nos.nl/${slug}`);
}

// Geen nieuwsbericht: overzichten van meerdere onderwerpen (tv-samenvattingen zoals
// "30/10 in Nieuwsuur: …", de "Wekdienst", met • tussen de onderwerpen) en podcasts.
export function isNewsItem(title: string) {
  return !(/^(podcast|wekdienst)\b/i.test(title) || /^\d{1,2}\/\d{1,2}\s+in\s/i.test(title) || title.includes(' • '));
}

// Berichten uit meerdere feeds samen: elk bericht één keer (een bericht kan in Binnenland én
// Politiek staan), en alleen echte nieuwsberichten. Bij dubbel telt de eerste lijst: geef de
// Nederlandse feeds dus vóór Buitenland mee.
export function mergeFeeds<T extends { id: string; sourceUrl: string; title: string }>(lists: T[][]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of lists.flat()) {
    if (!isNewsItem(item.title) || seen.has(item.id) || seen.has(item.sourceUrl)) continue;
    seen.add(item.id);
    seen.add(item.sourceUrl);
    merged.push(item);
  }
  return merged;
}

// Een videobericht: de NOS-videofeed (nosnieuwsvideo) geeft de duur van de video mee,
// <itunes:duration>00:00:44</itunes:duration>. Het videobestand zelf staat niet in de feed, wel op
// de NOS-pagina (lib/video.ts).
export function feedHasVideo(item: string): boolean {
  return /<itunes:duration>\s*\d/.test(item);
}

// De afbeelding van een bericht: <enclosure type="image/webp" url="https://images.cdn.nos.nl/…"/>.
// Alleen een https-adres van een afbeelding, anders null.
export function feedImage(item: string): string | null {
  for (const [el] of item.matchAll(/<(?:enclosure|media:content)\b[^>]*>/g)) {
    const type = el.match(/\btype="([^"]*)"/)?.[1] ?? '';
    const url = (el.match(/\burl="([^"]*)"/)?.[1] ?? '').replace(/&amp;/g, '&');
    if ((!type || type.startsWith('image/')) && /^https:\/\/[^\s"'<>]+$/.test(url)) return url;
  }
  return null;
}
