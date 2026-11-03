// Welke NOS-feeds Nova leest, en wat daarvan echt een nieuwsbericht is. Geen afhankelijkheden:
// ook bruikbaar in de tests.
//
// Nova vertelt over nieuws uit Nederland: standaard de feeds Binnenland en Politiek. Economie is
// gemengd (veel buitenlandse bedrijven) en Buitenland valt erbuiten. Anders instellen met
// NEWS_FEEDS, bijvoorbeeld NEWS_FEEDS=nosnieuwsbinnenland,nosnieuwspolitiek,nosnieuwseconomie.

export const DEFAULT_FEEDS = ['nosnieuwsbinnenland', 'nosnieuwspolitiek'];

export function feedUrls(setting?: string) {
  const slugs = (setting || DEFAULT_FEEDS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-z]+$/.test(s));
  return (slugs.length ? slugs : DEFAULT_FEEDS).map((slug) => `https://feeds.nos.nl/${slug}`);
}

// Geen nieuwsbericht: overzichten van meerdere onderwerpen (tv-samenvattingen zoals
// "30/10 in Nieuwsuur: …", de "Wekdienst", met • tussen de onderwerpen) en podcasts.
export function isNewsItem(title: string) {
  return !(/^(podcast|wekdienst)\b/i.test(title) || /^\d{1,2}\/\d{1,2}\s+in\s/i.test(title) || title.includes(' • '));
}

// Berichten uit meerdere feeds samen: elk bericht één keer (een bericht kan in Binnenland én
// Politiek staan), en alleen echte nieuwsberichten.
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
