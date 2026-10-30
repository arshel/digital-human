import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_FEEDS, feedUrls, isNewsItem, mergeFeeds } from '../lib/feeds.ts';

// Nederlands nieuws: welke feeds, en wat is een nieuwsbericht. Voorbeelden uit de NOS-feeds van
// 30 oktober 2026.

describe('NOS-feeds', () => {
  it('standaard Binnenland en Politiek', () => {
    assert.deepEqual(DEFAULT_FEEDS, ['nosnieuwsbinnenland', 'nosnieuwspolitiek']);
    assert.deepEqual(feedUrls(), ['https://feeds.nos.nl/nosnieuwsbinnenland', 'https://feeds.nos.nl/nosnieuwspolitiek']);
  });

  it('instelbaar, maar alleen nette namen', () => {
    assert.deepEqual(feedUrls('nosnieuwseconomie, nosnieuwsbinnenland'), ['https://feeds.nos.nl/nosnieuwseconomie', 'https://feeds.nos.nl/nosnieuwsbinnenland']);
    assert.deepEqual(feedUrls('../evil,https://x'), feedUrls(), 'rommel: dan de standaard');
  });
});

describe('wat is een nieuwsbericht', () => {
  it('overzichten en podcasts niet', () => {
    for (const title of [
      '30/10 in Nieuwsuur: Met wie kan het kabinet zaken doen? • Nederlandse economie',
      'Wekdienst 30/10: Kabinet praat verder over begroting • Stationsgebouw',
      'Podcast De Stemming: Maagzuur, een rechtse boyband en een shake-out',
    ]) {
      assert.equal(isNewsItem(title), false, title);
    }
  });

  it('gewone berichten wel, ook het weer', () => {
    for (const title of [
      'Man rent op koning af bij werkbezoek in Ursem, beveiligers grijpen in',
      'Het wordt een droog weekend met weinig wind, maar niet altijd zonnig',
      "'Wintersteunpakket' voor Oekraïne: Nederland geeft 500 miljoen",
    ]) {
      assert.equal(isNewsItem(title), true, title);
    }
  });

  it('samenvoegen: elk bericht één keer, zonder overzichten', () => {
    const a = { id: '1', sourceUrl: 'https://nos.nl/l/1', title: 'Kabinet praat verder' };
    const b = { id: '2', sourceUrl: 'https://nos.nl/l/2', title: 'Podcast De Stemming: iets' };
    const c = { id: '3', sourceUrl: 'https://nos.nl/l/3', title: 'Ophokplicht voor pluimvee' };
    assert.deepEqual(mergeFeeds([[a, b], [a, c]]).map((x) => x.id), ['1', '3']);
  });
});
