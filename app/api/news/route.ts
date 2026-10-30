import { getArticles, meta, NEWS_MODE } from '@/lib/articles';
import { after } from 'next/server';
import { aiProviders, generateExplanation } from '@/lib/ai';
import { AVATAR_MODE, DEV_TOOLS } from '@/lib/config';
import { warmCores } from '@/lib/corecache';
import { agentThumbnail } from '@/lib/did';
import { PROMPT_VERSION } from '@/lib/prompt';

// Wat de pagina nodig heeft vóór "Start": de berichten (zonder brontekst), de modi en het
// stilstaande beeld van de presentator. Geen stream. Wel zet deze route op de achtergrond de
// basisuitleg van het eerste bericht klaar (één keer per artikel- en promptversie), zodat Start
// niet op het taalmodel wacht. Het volgende bericht zet /api/explain klaar tijdens het luisteren:
// alles tegelijk zou de minuutlimiet van Groq meteen opmaken.
export async function GET() {
  // Ontwikkelmodus roept de D-ID-API niet aan: dan alleen DID_POSTER_URL (een stilstaand plaatje).
  const [{ articles, live }, poster] = await Promise.all([
    getArticles(),
    process.env.DID_POSTER_URL || (AVATAR_MODE === 'did' ? agentThumbnail() : null),
  ]);
  // after(): na het versturen van dit antwoord, en de server houdt het werk vast tot het klaar is.
  if (live) {
    after(() => warmCores(articles.slice(0, 1), `${PROMPT_VERSION}/${aiProviders()[0]}`, (article) => generateExplanation({ article, action: 'core', previous: [] })));
  }
  return Response.json({
    newsMode: NEWS_MODE,
    avatarMode: AVATAR_MODE,
    devTools: DEV_TOOLS,
    promptVersion: PROMPT_VERSION,
    // Bij Anam: het beeld en de wachtvideo van de Anam-avatar zelf (public/anam), met dezelfde
    // uitsnede als de stream. Zo verspringt het beeld niet als Nova na Start begint.
    poster: AVATAR_MODE === 'anam' ? process.env.ANAM_POSTER_URL || '/anam/nova.webp' : poster,
    // Stil, bewegend beeld van de agent voor vóór Start: een bestand, geen stream en geen kosten.
    // Alleen bij D-ID: het is een D-ID-bestand, en bij Anam zou het op een andere avatar lijken.
    idleVideo: AVATAR_MODE === 'did' ? process.env.DID_IDLE_VIDEO_URL || null : AVATAR_MODE === 'anam' ? process.env.ANAM_IDLE_VIDEO_URL || '/anam/nova-idle.mp4' : null,
    // Zijn het demo-artikelen (feed onbereikbaar), dan geen berichten: die tonen we niet als nieuws.
    articles: live ? articles.map(meta) : [],
  });
}
