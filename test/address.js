'use strict';

const {
  parseAddressParts,
  geocodeVariants,
  scoreMatch,
  cityMatches,
  houseMatches,
  streetMatches,
  streetTypeConflicts,
} = require('../lib/address');

let failures = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL: ' + msg);
    failures++;
    return false;
  }
  console.log('ok   ' + msg);
  return true;
}

function parts(address) {
  const p = parseAddressParts(address);
  return { city: p.city, street: p.street, house: p.house };
}

function same(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, msg + ' -> ' + a + (a === e ? '' : ' (expected ' + e + ')'));
}

// ---------------------------------------------------------------- parsing
same(parts('Челябинск, пр-кт Победы, 147а'),
  { city: 'Челябинск', street: 'проспект Победы', house: '147а' },
  'parses «пр-кт» and trailing house');

same(parts('Челябинск, ул. Троицкий тракт, 11'),
  { city: 'Челябинск', street: 'улица Троицкий тракт', house: '11' },
  'keeps «тракт» inside the street name');

same(parts('Челябинск, Троицкий тракт, 11'),
  { city: 'Челябинск', street: 'Троицкий тракт', house: '11' },
  'parses a street without a type word');

same(parts('г. Челябинск, ул. Кирова, д. 5'),
  { city: 'Челябинск', street: 'улица Кирова', house: '5' },
  'strips the «г.» and «д.» markers');

same(parts('Челябинск, ул. Кирова, 5/1'),
  { city: 'Челябинск', street: 'улица Кирова', house: '5/1' },
  'parses a fractional house number');

same(parts('г. Челябинск, ул. Кирова, д. 5').city, 'Челябинск', 'city is not polluted by street type');

// ---------------------------------------------------------------- variants
const v147 = geocodeVariants('Челябинск, пр-кт Победы, 147а');
assert(v147.length >= 4, 'generates several query variants (' + v147.length + ')');
assert(v147.includes('Челябинск, проспект Победы, 147а'), 'variant expands «пр-кт» claims idly');
assert(v147.some((q) => q === 'проспект Победы, 147а, Челябинск'), 'variant puts the city last');
assert(v147.filter((q) => q.includes('Челябинск')).length >= 4, 'city-qualified variants come first');
assert(v147[0].includes('Челябинск') && v147[1].includes('Челябинск'), 'raw and expanded variants keep the city');
assert(new Set(v147.map((q) => q.toLowerCase())).size === v147.length, 'variants are unique');

const vKirova = geocodeVariants('г. Челябинск, ул. Кирова, д. 5');
assert(vKirova.some((q) => /Кирова/.test(q) && /Челябинск/.test(q)), 'house variant keeps street, house and city');

// ---------------------------------------------------------------- matching
const dn147 = '147А, проспект Победы, Калининский район, Челябинск, Челябинский городской округ, Челябинская область, 454084, Россия';
const p147 = parseAddressParts('Челябинск, пр-кт Победы, 147а');
assert(cityMatches(dn147, 'Челябинск'), 'accepts a hit in the requested city');
assert(!cityMatches('5, улица Кирова, Верхний Уфалей, Челябинская область', 'Челябинск'),
  'rejects a hit from another city of the same region');
assert(houseMatches(dn147, '147а') > 0, 'accepts the requested house number');
assert(houseMatches(dn147, '149') < 0, 'rejects a different house number');
assert(houseMatches('54/11, Троицкий тракт, Челябинск', '11') < 0,
  'does not accept «54/11» as house 11');
assert(houseMatches('11, Троицкий тракт, Челябинск', '11') > 0, 'accepts a standalone house number');
assert(streetMatches(dn147, p147.street), 'accepts the requested street');
assert(!streetMatches(dn147, 'улица Кирова'), 'rejects another street');
assert(!streetTypeConflicts(dn147, p147.street), 'no street-type conflict for проспект');
assert(!streetTypeConflicts('11, Троицкий тракт, Челябинск', 'улица Троицкий тракт'),
  '«улица Троицкий тракт» does not conflict with plain «Троицкий тракт»');
assert(!streetTypeConflicts('5, улица Кирова, Челябинск', 'улица Кирова'), 'same street type does not conflict');
assert(streetTypeConflicts('5, проспект Кирова, Челябинск', 'улица Кирова'),
  'a different street type conflicts');

assert(scoreMatch(dn147, p147) >= 5, 'full match scores high (' + scoreMatch(dn147, p147) + ')');
assert(scoreMatch('5, улица Кирова, Верхний Уфалей, Челябинская область', parseAddressParts('г. Челябинск, ул. Кирова, д. 5')) < 0,
  'wrong-city hit scores negative');
assert(scoreMatch('11, Троицкий тракт, Советский район, Челябинск', parseAddressParts('Челябинск, Троицкий тракт, 11')) >= 5,
  'Троицкий тракт 11 scores high');
assert(scoreMatch('11, улица Ленина, Челябинск', parseAddressParts('Челябинск, Троицкий тракт, 11')) < 0,
  'a different street on the same house number scores negative');

console.log(failures ? '\nADDRESS TESTS FAILED: ' + failures : '\nADDRESS TESTS PASSED');
process.exitCode = failures ? 1 : 0;
