import { getArticles, meta, NEWS_MODE } from '@/lib/articles';
import { after } from 'next/server';
import { aiProviders, generateExplanation } from '@/lib/ai';
import { AVATAR_MODE, DEV_TOOLS } from '@/lib/config';
import { warmCores } from '@/lib/corecache';
import { PROMPT_VERSION } from '@/lib/prompt';

// Wat de pagina nodig heeft vóór "Start": de berichten (zonder brontekst), de modi en het
// stilstaande beeld van de presentator. Geen stream. Wel zet deze route op de achtergrond de
// basisuitleg van het eerste bericht klaar (één keer per artikel- en promptversie), zodat Start
// niet op het taalmodel wacht. Het volgende bericht zet /api/explain klaar tijdens het luisteren:
// alles tegelijk zou de minuutlimiet van Groq meteen opmaken.
export async function GET() {
  const { articles, live } = await getArticles();
  // after(): na het versturen van dit antwoord, en de server houdt het werk vast tot het klaar is.
  if (live) {
    after(() => warmCores(articles.slice(0, 1), `${PROMPT_VERSION}/${aiProviders()[0]}`, (article) => generateExplanation({ article, action: 'core', previous: [] })));
  }
  return Response.json({
    newsMode: NEWS_MODE,
    avatarMode: AVATAR_MODE,
    devTools: DEV_TOOLS,
    promptVersion: PROMPT_VERSION,
    // Het beeld en de wachtvideo van de Anam-avatar zelf (public/anam): gewone bestanden, geen
    // stream en geen kosten, met dezelfde uitsnede als de stream. Zo verspringt het beeld niet als
    // Nova na Start begint.
    poster: process.env.ANAM_POSTER_URL || '/anam/nova.webp',
    idleVideo: AVATAR_MODE === 'anam' ? process.env.ANAM_IDLE_VIDEO_URL || '/anam/nova-idle.mp4' : null,
    // Zijn het demo-artikelen (feed onbereikbaar), dan geen berichten: die tonen we niet als nieuws.
    articles: live ? articles.map(meta) : [],
  });
}
