// Sessietoken voor LiveAvatar. Alleen deze route kent LIVEAVATAR_API_KEY: de browser
// krijgt uitsluitend het kortlevende sessietoken terug, nooit de key zelf.
//
// Dit is voorlopig een zichttest: LITE-modus (wij sturen later zelf audio), sandbox aan
// (kost geen credits, sessie stopt vanzelf na ongeveer een minuut) en de sandbox-avatar
// Wayne. De sessie zelf start de SDK in de browser met dit token; die roept daarvoor
// /v1/sessions/start aan. Zie docs.liveavatar.com/docs/lite-mode/lifecycle.

const TOKEN_URL = 'https://api.liveavatar.com/v1/sessions/token';
const SANDBOX_AVATAR_ID = 'dd73ea75-1218-4ef3-92ce-606d5f7fbc0a';

export async function POST() {
  const key = process.env.LIVEAVATAR_API_KEY;
  if (!key) {
    console.error('[liveavatar] LIVEAVATAR_API_KEY ontbreekt in .env.local');
    return Response.json({ error: 'LiveAvatar is niet geconfigureerd op de server.' }, { status: 500 });
  }

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-API-KEY': key },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        mode: 'LITE',
        is_sandbox: true,
        avatar_id: SANDBOX_AVATAR_ID,
        video_settings: { quality: 'high', encoding: 'H264' },
      }),
    });
  } catch (err) {
    console.error('[liveavatar] token niet opgehaald:', err);
    return Response.json({ error: 'LiveAvatar is niet bereikbaar.' }, { status: 502 });
  }

  const data = await res.json().catch(() => null);
  const sessionToken = data?.data?.session_token;

  if (!res.ok || typeof sessionToken !== 'string') {
    // Het antwoord van LiveAvatar loggen, niet de key. De client krijgt alleen de status.
    console.error(`[liveavatar] token mislukt (${res.status}):`, data?.message ?? data);
    return Response.json({ error: `LiveAvatar gaf status ${res.status}.` }, { status: 502 });
  }

  return Response.json({ sessionToken });
}
