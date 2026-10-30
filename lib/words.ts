// Moeilijke woorden die je in de tekst kunt aantikken, waarna Nova ze uitlegt.
//
// Het taalmodel stelt ze voor, bij hetzelfde antwoord (geen extra aanvraag): vakwoorden, lange
// samenstellingen, afkortingen. De server neemt alleen woorden die letterlijk in de uitgesproken
// tekst staan, met een korte uitleg, en hooguit drie. Op de pagina wordt alleen de eerste keer
// dat een woord voorkomt een link, zodat de tekst rustig blijft.
//
// Geen browser- of serverafhankelijkheden: ook bruikbaar in app/page.tsx.

export type HardWord = { word: string; explanation: string };
export type Segment = { text: string; word?: HardWord };

const MAX_WORDS = 3;
const MAX_EXPLANATION_WORDS = 25;

// Een woord als los woord: niet midden in een ander woord (ook niet met é, ë enz.).
function matcher(word: string) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

// Uit het antwoord van het model: alleen bruikbare woorden. `clean` maakt de uitleg schoon zoals
// de rest van de gesproken tekst.
export function pickHardWords(raw: unknown, spoken: string, clean: (text: string) => string): HardWord[] {
  if (!Array.isArray(raw)) return [];
  const picked: HardWord[] = [];
  for (const item of raw) {
    if (picked.length >= MAX_WORDS) break;
    if (!item || typeof item !== 'object') continue;
    const { woord, uitleg } = item as { woord?: unknown; uitleg?: unknown };
    if (typeof woord !== 'string' || typeof uitleg !== 'string') continue;
    const word = woord.trim();
    if (word.length < 2 || word.length > 40 || word.split(/\s+/).length > 3) continue;
    const found = spoken.match(matcher(word));
    if (!found) continue;
    const explanation = clean(uitleg);
    const length = explanation.split(/\s+/).filter(Boolean).length;
    if (!length || length > MAX_EXPLANATION_WORDS) continue;
    // Zoals het in de tekst staat (hoofdletters), en geen dubbele.
    if (picked.some((p) => p.word.toLowerCase() === found[0].toLowerCase())) continue;
    picked.push({ word: found[0], explanation });
  }
  return picked;
}

// De zinnen in stukjes: gewone tekst, en per woord de eerste plek waar het voorkomt.
export function linkWords(sentences: string[], words: HardWord[]): Segment[][] {
  const done = new Set<string>();
  return sentences.map((sentence) => {
    let segments: Segment[] = [{ text: sentence }];
    for (const word of words) {
      if (done.has(word.word.toLowerCase())) continue;
      const next: Segment[] = [];
      for (const segment of segments) {
        const found = !segment.word && !done.has(word.word.toLowerCase()) ? segment.text.match(matcher(word.word)) : null;
        if (!found || found.index === undefined) {
          next.push(segment);
          continue;
        }
        done.add(word.word.toLowerCase());
        const before = segment.text.slice(0, found.index);
        const after = segment.text.slice(found.index + found[0].length);
        if (before) next.push({ text: before });
        next.push({ text: found[0], word });
        if (after) next.push({ text: after });
      }
      segments = next;
    }
    return segments;
  });
}

// Wat Nova zegt als je een woord aantikt. Noemt de uitleg het woord zelf niet ("Dat betekent ..."),
// dan eerst het woord, zodat je hoort waar het over gaat.
export function spokenExplanation({ word, explanation }: HardWord) {
  if (matcher(word).test(explanation)) return explanation;
  return `${word[0].toUpperCase()}${word.slice(1)}. ${explanation}`;
}
