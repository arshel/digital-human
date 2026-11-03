import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_FEEDS, feedImage, feedUrls, isNewsItem, mergeFeeds } from '../lib/feeds.ts';

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

describe('afbeelding bij een bericht', () => {
  it('de enclosure uit de NOS-feed (3 november 2026)', () => {
    const item = `<item><title>Stikstofwet</title>
      <enclosure type="image/webp" url="https://images.cdn.nos.nl/8/9/5/N/X/3/11sQ1/8x187x3984x2241-1024x576.webp"/></item>`;
    assert.equal(feedImage(item), 'https://images.cdn.nos.nl/8/9/5/N/X/3/11sQ1/8x187x3984x2241-1024x576.webp');
  });

  it('geen afbeelding, geen https of geen beeld: null', () => {
    assert.equal(feedImage('<item><title>Zonder</title></item>'), null);
    assert.equal(feedImage('<item><enclosure type="image/jpeg" url="http://example.com/a.jpg"/></item>'), null);
    assert.equal(feedImage('<item><enclosure type="audio/mpeg" url="https://example.com/a.mp3"/></item>'), null);
    assert.equal(feedImage('<item><enclosure type="image/jpeg" url="javascript:alert(1)"/></item>'), null);
  });

  it('&amp; in het adres wordt &', () => {
    assert.equal(feedImage('<item><enclosure url="https://x.nl/a.jpg?w=1&amp;h=2" type="image/jpeg"/></item>'), 'https://x.nl/a.jpg?w=1&h=2');
  });
});
