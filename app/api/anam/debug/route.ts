// TIJDELIJK, alleen ontwikkelserver: de vorm van Anam-transcriptevents (rol, ids, vlaggen, lengte;
// geen tekst) in de serverlog, om te zien wat Anam werkelijk stuurt. Weghalen na de proef.
export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') return new Response(null, { status: 404 });
  const body = await req.json().catch(() => null);
  if (body && typeof body === 'object') {
    const safe = Object.fromEntries(
      Object.entries(body)
        .filter(([k]) => ['role', 'id', 'cid', 'mine', 'end', 'int', 'len', 'error', 'status'].includes(k))
        .map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 60) : v]),
    );
    console.log('[anam-event]', JSON.stringify(safe));
  }
  return new Response(null, { status: 204 });
}
