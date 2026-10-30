// Gesproken tekst schoonmaken voordat die naar de avatar en de ondertiteling gaat. Het model
// krijgt de opdracht alleen uitspreekbare tekst te geven, maar dat is geen garantie. Wat hier
// weggaat, zou de stem anders letterlijk voorlezen ("sterretje", een hele URL).

const MAX_CHARS = 1400;

export function cleanSpoken(raw: string) {
  const text = raw
    .replace(/\[[^\]]*\]/g, ' ') // [pauze], [glimlacht]
    .replace(/\((?:lacht|glimlacht|pauze|zucht|knikt)[^)]*\)/gi, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/\b[a-z0-9-]+\.(?:nl|com|org|net|eu|be)(?:\/\S*)?/gi, ' ')
    .replace(/[*_#`>~|]+/g, ' ')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\p{Extended_Pictographic}|️/gu, '')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= MAX_CHARS) return text;
  const cut = text.slice(0, MAX_CHARS);
  return cut.slice(0, cut.lastIndexOf('. ') + 1) || cut;
}

// Splitsen na . ! ? of … gevolgd door een hoofdletter, cijfer of aanhalingsteken.
// "o.a. de" en "1.000" blijven daardoor heel.
export function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?…]["”’)]?)\s+(?=["“‘(]?[A-ZÀ-ÖØ-Þ0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}
