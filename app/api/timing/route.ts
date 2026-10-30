import { ACTIONS } from '@/lib/prompt';

// Alleen voor de ontwikkelserver: per klik (cyclus) de meetpunten van pagina, server en
// presentator, in één regel in de serverlog. Wordt niet bewaard. Alleen getallen en korte codes,
// geen vraag- of antwoordtekst. Tijden in seconden na de klik.
//
// Een cyclus zonder "beeld" is nooit hoorbaar geworden (vervangen door een nieuwere klik).

const STEPS = ['text', 'connect-start', 'connected', 'speak-sent', 'speak-accepted', 'playing', 'audio'] as const;
const CACHE = ['ready', 'pending', 'miss', 'none'];

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 3_600_000 ? v : null);
const code = (v: unknown) => (typeof v === 'string' ? v.replace(/[^\w:.\-/]/g, '').slice(0, 48) : '');
const sec = (ms: number | null) => (ms === null ? '-' : `${(ms / 1000).toFixed(1)}s`);

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') return new Response(null, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return new Response(null, { status: 400 });

  const steps = (body.steps ?? {}) as Record<string, unknown>;
  const at = Object.fromEntries(STEPS.map((s) => [s, num(steps[s])]));
  const server = (body.server ?? {}) as Record<string, unknown>;
  const cache = CACHE.includes(server.cache as string) ? server.cache : '?';
  const attempts = Array.isArray(server.attempts)
    ? server.attempts.slice(0, 8).map((a: Record<string, unknown>) => `${code(a.model)} ${num(a.ms) ?? '?'}ms ${code(a.result)}`)
    : [];
  const closed = Array.isArray(body.closed) ? body.closed.slice(0, 4).map(code) : [];

  const parts = [
    `[timing] #${num(body.cycle) ?? '?'} ${ACTIONS.includes(body.action) ? body.action : '?'}`,
    `req ${code(server.requestId).slice(0, 8) || '-'}`,
    `cache ${cache}`,
    `artikel ${num(server.articleMs) ?? '-'}ms`,
    `server ${num(server.generateMs) ?? '-'}ms${attempts.length ? ` (${attempts.join('; ')})` : ''}`,
    `tekst ${sec(at.text)}`,
    at['connect-start'] === null && at.connected === null
      ? 'verbinding bestond al'
      : `verbinden ${sec(at['connect-start'])} → ${sec(at.connected)}${body.stream ? ` (${code(body.stream)})` : ''}`,
    `speak ${sec(at['speak-sent'])} → geaccepteerd ${sec(at['speak-accepted'])}`,
    `beeld ${sec(at.playing)}`,
    `geluid ${sec(at.audio)}`,
  ];
  if (closed.length) parts.push(`gesloten: ${closed.join(', ')}`);
  if (body.replaced === true) parts.push('VERVANGEN door nieuwere klik');
  console.log(parts.join(' · '));
  return new Response(null, { status: 204 });
}
