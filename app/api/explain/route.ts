import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { aiProviders, generateExplanation, routeQuestion, type Explanation } from '@/lib/ai';
import { findArticle, getArticles } from '@/lib/articles';
import { asForeground, coreExplanation, warmWhenQuiet, type CacheState } from '@/lib/corecache';
import { DEV_TOOLS } from '@/lib/config';
import { PROMPT_VERSION } from '@/lib/prompt';
import { answerQuestion } from '@/lib/questions';
import { rateLimited, tooMany } from '@/lib/ratelimit';
import { splitSentences } from '@/lib/spoken';
import { logLine } from '@/lib/testlog';
import { validateExplain } from '@/lib/validate';

// De enige route naar het taalmodel. Het antwoord hoort altijd bij het bericht dat de client noemt, en
// bron, datum en versie komen uit de gevalideerde artikelgegevens op de server, nooit uit het model.

export async function POST(req: Request) {
  if (rateLimited(req, 'explain', 20)) return tooMany();

  const body: unknown = await req.json().catch(() => null);
  const valid = validateExplain(body);
  if (typeof valid === 'string') return Response.json({ error: `Ongeldige aanvraag: ${valid}` }, { status: 400 });

  // Foutsimulatie voor ontwikkelaars (knoppen in het ontwikkelpaneel). Nooit in een echte test.
  const simulate = DEV_TOOLS ? req.headers.get('x-nova-simulate') : null;
  if (simulate === 'server-error') return Response.json({ error: 'Gesimuleerde serverfout.' }, { status: 503 });

  const articleStart = Date.now();
  const article = await findArticle(valid.articleId);
  const articleMs = Date.now() - articleStart;
  if (!article) return Response.json({ error: 'Dit bericht is niet (meer) beschikbaar.' }, { status: 404 });

  // De basisuitleg staat meestal al klaar (zie lib/corecache.ts). Al het andere: nu vragen.
  const cacheKey = `${PROMPT_VERSION}/${aiProviders()[0]}`;
  const makeCore = (a: typeof article) => generateExplanation({ article: a, action: 'core', previous: [] });
  const isCore = valid.action === 'core' && valid.previous.length === 0 && !simulate;
  const generateStart = Date.now();
  // Een vraag over ander nieuws van vandaag wordt beantwoord uit dát bericht (lib/questions.ts);
  // `answered` is dan dat bericht, en daar horen bron, datum en versie van het antwoord bij.
  let answered = article;
  let switchedFrom: string | null = null;
  const answer = await asForeground<Explanation & { cache: CacheState | 'none' }>(async () => {
    if (isCore) return coreExplanation(article, cacheKey, makeCore);
    const ask = (target: typeof article, previous: typeof valid.previous) =>
      generateExplanation({
        article: target,
        action: valid.action,
        previous,
        question: valid.question,
        simulateFailure: simulate === 'gemini-error',
      });
    if (valid.action !== 'question' || !valid.question) {
      return { ...(await ask(article, valid.previous)), cache: 'none' as const };
    }
    const { articles } = await getArticles();
    const result = await answerQuestion(article, valid.previous, articles, {
      answer: ask,
      route: (list) => routeQuestion(valid.question!, list),
    });
    answered = result.article;
    switchedFrom = result.switchedFrom;
    return { ...result.answer, cache: 'none' as const };
  });
  const generateMs = Date.now() - generateStart;
  // Modelpogingen alleen als ze bij deze aanvraag hoorden (niet bij een eerdere voorbereiding).
  const attempts = answer.cache === 'ready' || answer.cache === 'pending' ? [] : answer.attempts;
  const requestId = randomUUID();

  // Terwijl de gebruiker luistert: de basisuitleg van het volgende bericht klaarzetten. Niet in het
  // antwoordpad: after() draait na het versturen van dit antwoord, en de server houdt het werk vast
  // tot het klaar is. En met lage voorrang (warmWhenQuiet): pas als er even geen gebruikersaanvraag
  // loopt, zodat het de minuutlimiet van het taalmodel niet opmaakt vlak voor een echte vraag.
  if (isCore) {
    after(async () => {
      const { articles, live } = await getArticles();
      const i = articles.findIndex((a) => a.id === article.id);
      if (live && i >= 0 && articles.length > 1) await warmWhenQuiet([articles[(i + 1) % articles.length]], cacheKey, makeCore);
    });
  }

  await logLine('answers', {
    requestId,
    articleId: answered.id,
    articleVersion: answered.version,
    switchedFrom,
    promptVersion: answer.promptVersion,
    action: valid.action,
    mode: answer.mode,
    model: answer.model,
    cache: answer.cache,
    articleMs,
    generateMs,
    attempts,
    hardWords: answer.words.length,
    words: answer.spoken.split(/\s+/).length,
    // Taalniveau volgen zonder de tekst zelf te bewaren: richtlijn is ongeveer 10 woorden per zin.
    wordsPerSentence: Math.round((answer.spoken.split(/\s+/).length / splitSentences(answer.spoken).length) * 10) / 10,
  });

  return Response.json({
    requestId,
    articleId: answered.id,
    articleVersion: answered.version,
    // Ging de vraag over een ander bericht van vandaag, dan staat hier het bericht in beeld.
    switchedFrom,
    promptVersion: answer.promptVersion,
    mode: answer.mode,
    spoken: answer.spoken,
    words: answer.words,
    // Voor de metingen (app/api/timing): geen tekst.
    timing: { cache: answer.cache, articleMs, generateMs, attempts },
  });
}
