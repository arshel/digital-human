import { AVATAR_MODE, DEV_TOOLS } from '@/lib/config';
import { credits, usage } from '@/lib/did';
import { rateLimited, tooMany } from '@/lib/ratelimit';
import { logLine } from '@/lib/testlog';

// Verbruik van de D-ID-stream bijhouden. De browser meldt per speak() de videoduur die de
// D-ID-API teruggaf (spoken), en bij het sluiten hoe lang de verbinding openstond (connected,
// eigen klok, dus een schatting). Geen gespreksinhoud.

export async function POST(req: Request) {
  if (rateLimited(req, 'did-usage', 60)) return tooMany();
  if (AVATAR_MODE !== 'did') return new Response(null, { status: 204 });

  const body = await req.json().catch(() => null);
  const kind = body?.kind;
  const seconds = Number(body?.seconds);
  if ((kind !== 'spoken' && kind !== 'connected') || !Number.isFinite(seconds) || seconds < 0 || seconds > 3600) {
    return Response.json({ error: 'Ongeldige aanvraag' }, { status: 400 });
  }
  await logLine('did-usage', {
    kind,
    seconds: Math.round(seconds * 10) / 10,
    source: kind === 'spoken' ? 'd-id api (speak duration)' : 'browser clock (estimate)',
    videoId: typeof body.videoId === 'string' ? body.videoId.slice(0, 100) : undefined,
  });
  return new Response(null, { status: 204 });
}

// Voor het ontwikkelpaneel: eigen telling plus het tegoed volgens D-ID (GET /credits).
export async function GET() {
  if (!DEV_TOOLS) return new Response(null, { status: 404 });
  const [used, provider] = await Promise.all([usage(), credits()]);
  return Response.json({ ...used, credits: provider });
}
