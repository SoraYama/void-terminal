import {describe, expect, it} from 'vitest';
import {mapCardFixture} from './fixtures/map-card';
import {parseMapCards, mapTileUrl, mapIconUrl} from '../src/lib/map-cards';

describe('validated map message protocol', () => {
  it('retains known-schema cards with real point identities and a separate map snapshot', () => {
    const [card] = parseMapCards([mapCardFixture]);
    expect(card?.markers.map(p => p.id)).toEqual([33876, 33877]);
    expect(card?.snapshotId).toBe('map-7.2-fixture');
    expect(card?.count).toBe(2);
  });
  it.each([
    {schemaVersion: 2}, {snapshotId: '../private'}, {count: -1}, {count: 1},
    {count: 3, truncated: false},
    {markers: [{...mapCardFixture.markers[0], x: Infinity}]},
    {sources: [{label: 'bad', url: 'javascript:alert(1)'}]},
    {map: {...mapCardFixture.map, revision: '../../secret'}},
    {markers: Array.from({length: 501}, (_, i) => ({...mapCardFixture.markers[0], id: i + 1})), count: 501},
  ])('rejects untrusted or misleading card fields: %j', patch => {
    expect(parseMapCards([{...mapCardFixture, ...patch}])).toEqual([]);
  });
  it('does not discard valid cards beside an invalid persisted card, and caps a message', () => {
    expect(parseMapCards([null, mapCardFixture, ...Array.from({length: 5}, (_, i) => ({...mapCardFixture, id: `extra-${i}`}))])).toHaveLength(4);
  });
  it('derives immutable same-origin asset URLs, never a model supplied address', () => {
    const [card] = parseMapCards([mapCardFixture]);
    expect(mapTileUrl(card, 15, 21, -14)).toBe('/api/maps/assets/map-7.2-fixture/tiles/teyvat/15/21/-14.jpg');
    expect(mapIconUrl(card)).toBe('/api/maps/assets/map-7.2-fixture/icons/o403.png');
  });
  it('retains optional English geography while accepting historical cards without it', () => {
    const [card] = parseMapCards([{...mapCardFixture,region:{...mapCardFixture.region,countryEn:'Sumeru',parentNameEn:'Ardravi Valley'}}]);
    expect(card.region.countryEn).toBe('Sumeru');
    expect(card.region.parentNameEn).toBe('Ardravi Valley');
    expect(parseMapCards([mapCardFixture])).toHaveLength(1);
  });
});
