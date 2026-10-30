import type { Explanation } from './ai';
import type { NewsArticle } from './articles';

// De basisuitleg (de knop Start) is per bericht altijd dezelfde vraag aan het taalmodel: geen
// gesprek ervoor, geen vraag van de gebruiker. Die maken we dus één keer per artikelversie en
// promptversie, en al vooraf (zie /api/news). Dan wacht Start niet op het taalmodel. Bijkomend
// voordeel voor een gebruikerstest: iedereen hoort dezelfde kern.
//
// Alleen in het geheugen van de server, en alleen de basisuitleg: geen vragen of gesprekken.
// Een terugval-antwoord (taalmodel mislukt) bewaren we niet, zodat de volgende keer het model
// weer een kans krijgt.

type Generate = (article: NewsArticle) => Promise<Explanation>;

// Hoe de basisuitleg er was: al klaar, nog bezig (een eerdere aanvraag of de voorbereiding), of
// nu pas gevraagd.
export type CacheState = 'ready' | 'pending' | 'miss';

type Entry = { promise: Promise<Explanation>; done: boolean };

const MAX = 50;

// Op globalThis: in de ontwikkelserver krijgt elke route een eigen kopie van deze module.
const store = globalThis as typeof globalThis & {
  __novaCore?: Map<string, Entry>;
  __novaForeground?: { active: number; last: number };
};
const cache = (store.__novaCore ??= new Map());
// Aanvragen van een gebruiker die nu lopen, en wanneer de laatste eindigde. Voorbereiding wacht
// daarop, zodat die de minuutlimiet van het taalmodel niet opmaakt vlak voor een echte vraag.
const foreground = (store.__novaForeground ??= { active: 0, last: 0 });

export async function coreExplanation(
  article: NewsArticle,
  promptVersion: string,
  generate: Generate,
): Promise<Explanation & { cache: CacheState }> {
  const key = `${article.id}@${article.version}@${promptVersion}`;
  const hit = cache.get(key);
  if (hit) {
    const state = hit.done ? 'ready' : 'pending';
    return { ...(await hit.promise), cache: state };
  }

  const entry: Entry = { promise: Promise.resolve() as never, done: false };
  entry.promise = generate(article).then(
    (answer) => {
      entry.done = true;
      if (answer.mode !== 'ai') cache.delete(key);
      return answer;
    },
    (err) => {
      cache.delete(key);
      throw err;
    },
  );
  cache.set(key, entry);
  // Oudste eruit: in de live-modus komen er steeds nieuwe berichten bij.
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  return { ...(await entry.promise), cache: 'miss' };
}

// Werk voor een gebruiker die nu wacht. Voorbereiding laat dit voorgaan.
export async function asForeground<T>(work: () => Promise<T>): Promise<T> {
  foreground.active++;
  try {
    return await work();
  } finally {
    foreground.active--;
    foreground.last = Date.now();
  }
}

// Op de achtergrond klaarzetten. Fouten zijn hier niet erg: Start probeert het dan zelf opnieuw.
export function warmCores(articles: NewsArticle[], promptVersion: string, generate: Generate) {
  return Promise.all(articles.map((article) => coreExplanation(article, promptVersion, generate).catch(() => null)));
}

// Klaarzetten met lage voorrang: pas als er geen gebruikersaanvraag loopt en de laatste minstens
// `quietMs` geleden eindigde. Lukt dat niet binnen `maxWaitMs`, dan niet: de basisuitleg wordt
// dan gewoon gemaakt als de gebruiker erom vraagt.
export async function warmWhenQuiet(
  articles: NewsArticle[],
  promptVersion: string,
  generate: Generate,
  { quietMs = 15000, pollMs = 1000, maxWaitMs = 120000 } = {},
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (foreground.active > 0 || Date.now() - foreground.last < quietMs) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  await warmCores(articles, promptVersion, generate);
  return true;
}

export function clearCores() {
  cache.clear();
  foreground.active = 0;
  foreground.last = 0;
}
