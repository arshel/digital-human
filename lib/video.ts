// NOS-video achter Nova, als test (NOVA_NEWS_VIDEO=aan, met NEWS_FEEDS=nosnieuwsvideo).
//
// De videofeed van de NOS geeft geen videobestand, alleen een link naar de NOS-pagina. Die pagina
// beschrijft de video in schema.org-gegevens met een "contentUrl": een adres bij de
// streamingdienst van de NOS (resolver.streaming.api.nos.nl, profiel hls_unencrypted). Dat stuurt
// door naar een HLS-stream (.m3u8). Niet geografisch afgeschermd en met CORS voor elke site
// (gecontroleerd 12 november 2026). De pagina speelt die zonder geluid af, met hls.js
// (components/NewsBackdrop.tsx).
//
// Alleen voor een lokale test: NOS-video op een eigen site tonen vraagt toestemming van de NOS.

const STREAM = /^https:\/\/resolver\.streaming\.api\.nos\.nl\/stream\?[^\s"'<>]+$/;
const PAGE = /^https:\/\/nos\.nl\//;

export const isNosPage = (url: string) => PAGE.test(url);

// Het streamadres uit de HTML van een NOS-videopagina, of null. Alleen een adres van de
// streamingdienst van de NOS telt.
export function streamFromPage(html: string): string | null {
  for (const [, raw] of html.matchAll(/"contentUrl"\s*:\s*"([^"]+)"/g)) {
    const url = raw.replace(/\\u0026/gi, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');
    if (STREAM.test(url)) return url;
  }
  return null;
}
