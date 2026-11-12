import { findArticle } from '@/lib/articles';
import { rateLimited, tooMany } from '@/lib/ratelimit';
import { isNosPage, streamFromPage } from '@/lib/video';

// Het streamadres van de NOS-video bij een bericht (lib/video.ts). Alleen voor berichten die de
// server zelf liet zien en die een video hebben: zo haalt deze route nooit een willekeurig adres op.
// Een half uur vastgehouden; het adres van de streamingdienst geeft telkens een verse stream.

const CACHE_MS = 30 * 60 * 1000;
const cache = new Map<string, { url: string | null; at: number }>();

export async function GET(req: Request) {
  if (rateLimited(req, 'video', 60)) return tooMany();
  const id = new URL(req.url).searchParams.get('id')?.slice(0, 60) ?? '';
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return answer(hit.url);

  const article = id ? await findArticle(id) : null;
  if (!article?.video || !isNosPage(article.url)) return answer(null);

  const html = await fetch(article.url, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0 (Nova test)' } })
    .then((res) => (res.ok ? res.text() : ''))
    .catch(() => '');
  const url = streamFromPage(html);
  if (!url) console.warn('[video] geen stream gevonden voor', id);
  if (cache.size > 200) cache.clear();
  cache.set(id, { url, at: Date.now() });
  return answer(url);
}

const answer = (url: string | null) => Response.json({ url }, { status: url ? 200 : 404 });
