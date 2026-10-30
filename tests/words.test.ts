import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanSpoken } from '../lib/spoken.ts';
import { linkWords, pickHardWords, spokenExplanation } from '../lib/words.ts';

// Moeilijke woorden: alleen wat echt in de tekst staat, hooguit drie, en één link per woord.

const SPOKEN = 'Het kabinet wil de boetes verhogen met de inflatie. De Tweede Kamer vindt dat niet goed. Inflatie is hoog.';

describe('moeilijke woorden kiezen', () => {
  it('neemt alleen woorden die letterlijk in de tekst staan', () => {
    const words = pickHardWords(
      [
        { woord: 'inflatie', uitleg: 'Inflatie betekent dat alles duurder wordt.' },
        { woord: 'kwijtschelding', uitleg: 'Je hoeft het niet te betalen.' }, // staat er niet in
      ],
      SPOKEN,
      cleanSpoken,
    );
    assert.deepEqual(words.map((w) => w.word), ['inflatie']);
  });

  it('niet midden in een ander woord, wel met hoofdletters zoals in de tekst', () => {
    assert.deepEqual(pickHardWords([{ woord: 'kabine', uitleg: 'Een hokje.' }], SPOKEN, cleanSpoken), []);
    const words = pickHardWords([{ woord: 'tweede kamer', uitleg: 'Het parlement dat wetten maakt.' }], SPOKEN, cleanSpoken);
    assert.equal(words[0].word, 'Tweede Kamer');
  });

  it('hooguit drie, geen dubbele, en geen lange of lege uitleg', () => {
    const lang = Array(30).fill('woord').join(' ') + '.';
    const words = pickHardWords(
      [
        { woord: 'kabinet', uitleg: 'De regering.' },
        { woord: 'Kabinet', uitleg: 'Nog een keer.' },
        { woord: 'boetes', uitleg: lang },
        { woord: 'verhogen', uitleg: '' },
        { woord: 'inflatie', uitleg: 'Alles wordt duurder.' },
        { woord: 'Tweede Kamer', uitleg: 'Het parlement.' },
        { woord: 'goed', uitleg: 'Fijn.' },
      ],
      SPOKEN,
      cleanSpoken,
    );
    assert.deepEqual(words.map((w) => w.word), ['kabinet', 'inflatie', 'Tweede Kamer']);
  });

  it('kan tegen rommel van het model', () => {
    assert.deepEqual(pickHardWords(undefined, SPOKEN, cleanSpoken), []);
    assert.deepEqual(pickHardWords([null, 3, { woord: 5 }], SPOKEN, cleanSpoken), []);
  });
});

describe('links in de tekst', () => {
  it('alleen de eerste keer dat een woord voorkomt is een link', () => {
    const sentences = ['Het kabinet wil de boetes verhogen met de inflatie.', 'Inflatie is hoog.'];
    const inflatie = { word: 'inflatie', explanation: 'Alles wordt duurder.' };
    const parts = linkWords(sentences, [inflatie]);
    assert.deepEqual(parts[0], [{ text: 'Het kabinet wil de boetes verhogen met de ' }, { text: 'inflatie', word: inflatie }, { text: '.' }]);
    assert.deepEqual(parts[1], [{ text: 'Inflatie is hoog.' }]);
  });

  it('meerdere woorden in één zin, en woorden van meer dan één woord', () => {
    const kamer = { word: 'Tweede Kamer', explanation: 'Het parlement.' };
    const kabinet = { word: 'kabinet', explanation: 'De regering.' };
    const parts = linkWords(['Het kabinet en de Tweede Kamer praten.'], [kamer, kabinet]);
    assert.deepEqual(
      parts[0].map((s) => [s.text, s.word?.word ?? null]),
      [
        ['Het ', null],
        ['kabinet', 'kabinet'],
        [' en de ', null],
        ['Tweede Kamer', 'Tweede Kamer'],
        [' praten.', null],
      ],
    );
  });

  it('zonder woorden: de zinnen zoals ze zijn', () => {
    assert.deepEqual(linkWords(['Een zin.'], []), [[{ text: 'Een zin.' }]]);
  });
});

describe('wat Nova zegt bij een aangetikt woord', () => {
  it('noemt eerst het woord als de uitleg dat niet doet', () => {
    assert.equal(spokenExplanation({ word: 'goedgekeurd', explanation: 'Dat betekent dat het officieel mag gebeuren.' }), 'Goedgekeurd. Dat betekent dat het officieel mag gebeuren.');
    assert.equal(spokenExplanation({ word: 'inflatie', explanation: 'Inflatie betekent dat alles duurder wordt.' }), 'Inflatie betekent dat alles duurder wordt.');
  });
});
