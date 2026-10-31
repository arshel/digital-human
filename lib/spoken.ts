// Gesproken tekst schoonmaken voordat die naar de avatar en de ondertiteling gaat. Het model
// krijgt de opdracht alleen uitspreekbare tekst te geven, maar dat is geen garantie. Wat hier
// weggaat, zou de stem anders letterlijk voorlezen ("sterretje", een hele URL).

const MAX_CHARS = 1400;

export function cleanSpoken(raw: string) {
  const text = raw
    // Tekens waar een stem over kan struikelen: onzichtbare afbreek- en scheidingstekens weg,
    // "harde" koppelstreepjes (Willem‑Alexander) gewoon, een gedachtestreepje wordt een komma.
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\u2010-\u2012]/g, '-')
    .replace(/\s+[\u2013\u2014]\s+/g, ', ')
    .replace(/[\u2013\u2014]/g, '-')
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
