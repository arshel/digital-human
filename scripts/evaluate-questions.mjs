// Node 26. Alleen /api/news en /api/explain; geen browser, microfoon of Anam.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { setTimeout as wait } from 'node:timers/promises';

export function checkStructure(test, data, bindings) {
  const expected = test.expected;
  const current = bindings[test.current];
  if (data.mode !== 'ai' || typeof data.spoken !== 'string' || !data.spoken.trim()) return false;
  if (expected.kind.startsWith('overzicht')) return data.overview === true && data.articleId === current;
  if (data.overview) return false;
  if (expected.target) {
    const prefix = expected.kind === 'buitenlands'
      ? 'Dat gaat over buitenlands nieuws van vandaag.' : 'Dat gaat over een ander bericht van vandaag.';
    return data.articleId === bindings[expected.target] && data.switchedFrom === current && data.spoken.startsWith(prefix);
  }
  if (data.articleId !== current || data.switchedFrom) return false;
  if (expected.kind === 'geen-nieuws') return /^(Ik heb vandaag geen nieuws over .+\.|Daar heb ik vandaag geen nieuws over\.)$/.test(data.spoken);
  return !/^(Ik heb vandaag geen nieuws|Daar heb ik vandaag geen nieuws)/.test(data.spoken);
}

export async function main() {
  const set = JSON.parse(await readFile(new URL('../evaluation/questions.nl.json', import.meta.url), 'utf8'));
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ cases: set.length, categories: Object.fromEntries([...new Set(set.map(t => t.expected.kind))].map(c => [c, set.filter(t => t.expected.kind === c).length])) }));
    return;
  }
  const bindingPath = process.env.NOVA_EVAL_BINDINGS;
  if (!bindingPath) throw new Error('NOVA_EVAL_BINDINGS ontbreekt. Zie evaluation/README.md; gebruik --dry-run voor controle zonder server.');
  // Expliciete koppeling: nooit automatisch een willekeurig feedbericht voor een vaste context kiezen.
  const bindings = JSON.parse(await readFile(bindingPath, 'utf8'));
  const base = process.env.NOVA_EVAL_URL || 'http://localhost:3000';
  const interval = Number(process.env.NOVA_EVAL_INTERVAL_MS || 90000);
  if (!Number.isFinite(interval) || interval < 60000) throw new Error('Wacht minimaal 60000 ms na ieder antwoord. Standaard 90000 ms.');
  const newsResponse = await fetch(`${base}/api/news`, { signal: AbortSignal.timeout(30000) });
  if (!newsResponse.ok) throw new Error(`Nieuws ophalen: HTTP ${newsResponse.status}`);
  const news = await newsResponse.json();
  const ids = new Set(news.articles.map(a => a.id));
  for (const name of ['haarlem', 'stikstof', 'amerika', 'oekraine']) {
    if (!ids.has(bindings[name])) throw new Error(`Context ${name} ontbreekt op server; geen geldige vaste evaluatie.`);
  }
  // GET /api/news kan één kernantwoord voorbereiden. Laat ook dat quotum eerst herstellen.
  await wait(interval);
  const review = process.argv.includes('--review') ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const stats = {};
  const limit = Number(process.env.NOVA_EVAL_LIMIT || set.length);
  let failed = false;
  for (const test of set.slice(0, limit)) {
    const count = stats[test.expected.kind] ??= { totaal: 0, structuurGoed: 0, fout: 0, inhoudTeBeoordelen: 0, inhoudGoed: 0, inhoudFout: 0 };
    count.totaal++;
    try {
      const res = await fetch(`${base}/api/explain`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ articleId: bindings[test.current], action: 'question', question: test.question, previous: test.previous || [] }),
        signal: AbortSignal.timeout(180000),
      });
      const data = await res.json();
      const ok = res.ok && checkStructure(test, data, bindings);
      count[ok ? 'structuurGoed' : 'fout']++;
      if (ok) count.inhoudTeBeoordelen++;
      if (review && res.ok) {
        console.log(test.question, '\n', test.expected.rubric, '\n', data.spoken);
        const judgment = await review.question('Inhoud juist? [j/n/enter=onbeoordeeld] ');
        if (/^[jn]$/i.test(judgment)) {
          count[/^j$/i.test(judgment) ? 'inhoudGoed' : 'inhoudFout']++;
          if (ok) count.inhoudTeBeoordelen--;
          if (/^n$/i.test(judgment)) failed = true;
        }
      }
      if (!ok) failed = true;
      // Geen vraag- of antwoordtekst opslaan, ook niet in de console.
      console.log(JSON.stringify({ id: test.id, status: res.status, structuurGoed: ok, requestId: data.requestId, attempts: data.timing?.attempts }));
    } catch (error) {
      count.fout++; failed = true;
      console.log(JSON.stringify({ id: test.id, error: error.name }));
    }
    if (count.totaal && test !== set.slice(0, limit).at(-1)) await wait(interval);
  }
  review?.close();
  console.log(JSON.stringify({ resultaten: stats, opmerking: 'Structuur is geen inhoudelijk oordeel. Beoordeel regio, tijdvak, feiten en A2 apart met de rubric.' }, null, 2));
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
