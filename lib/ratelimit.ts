// Rate limit in het geheugen van dit serverproces. Genoeg voor een prototype en een test: het
// remt een losgeslagen client of een tabblad dat blijft herhalen. Niet genoeg voor een publieke
// productieomgeving: elke serverinstantie telt apart en bij een herstart begint het opnieuw.
// Daar hoort een gedeelde teller bij (Upstash Redis) of de rate limit van het platform.

const WINDOW_MS = 60_000;
const buckets = new Map<string, Map<string, number[]>>();

export function rateLimited(req: Request, bucket: string, max: number) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'lokaal';
  const hits = buckets.get(bucket) ?? new Map<string, number[]>();
  buckets.set(bucket, hits);

  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) {
    for (const [key, times] of hits) if (now - times[times.length - 1] > WINDOW_MS) hits.delete(key);
  }
  return recent.length > max;
}

export function tooMany() {
  return Response.json(
    { error: 'Te veel vragen achter elkaar. Wacht even en probeer het opnieuw.' },
    { status: 429, headers: { 'retry-after': String(WINDOW_MS / 1000) } },
  );
}
