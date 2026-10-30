import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Testlog in logs/ (staat in .gitignore). Per antwoord: welk bericht in welke versie, welke
// promptversie, welke knop, ai of terugval en welk model. Bewust niet: de vraag van de
// gebruiker of de tekst van het antwoord. Persoonlijke gesprekken slaan we standaard niet op.
// Uitzetten met NOVA_TEST_LOG=0.

const DIR = path.join(process.cwd(), 'logs');

export async function logLine(file: 'answers', entry: Record<string, unknown>) {
  if (process.env.NOVA_TEST_LOG === '0') return;
  try {
    await mkdir(DIR, { recursive: true });
    await appendFile(path.join(DIR, `${file}.jsonl`), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch (err) {
    console.error('[testlog] niet geschreven:', err instanceof Error ? err.message : err);
  }
}

export async function readLines(file: 'answers') {
  try {
    const text = await readFile(path.join(DIR, `${file}.jsonl`), 'utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}
