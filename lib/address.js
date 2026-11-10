'use strict';

const STREET_ABBR = [
  ['пр-кт', 'проспект'],
  ['просп', 'проспект'],
  ['ул', 'улица'],
  ['пер', 'переулок'],
  ['ш', 'шоссе'],
  ['наб', 'набережная'],
  ['пл', 'площадь'],
  ['бул', 'бульвар'],
  ['проезд', 'проезд'],
  ['тракт', 'тракт'],
  ['стр', 'строение'],
  ['корп', 'корпус'],
  ['мкр', 'микрорайон'],
  ['пгт', 'посёлок'],
];

const STREET_TYPES = [
  'проспект',
  'улица',
  'переулок',
  'шоссе',
  'набережная',
  'площадь',
  'бульвар',
  'проезд',
  'тракт',
  'строение',
  'корпус',
  'микрорайон',
];

const CITY_HINTS = [
  'г', 'г.', 'гор', 'город', 'пос', 'пос.', 'поселок', 'пгт', 'с', 'с.', 'село',
  'дер', 'деревня', 'ст', 'ст.', 'станица', 'снт', 'днт', 'кп',
];

function words(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^0-9a-zа-яё]+/i)
    .filter(Boolean);
}

function expandAddressAbbreviations(address) {
  let out = String(address || '').trim();
  if (!out) return out;
  out = out.replace(/\s+/g, ' ');
  for (const [abbr, full] of STREET_ABBR) {
    const re = new RegExp('(^|[\\s,])' + abbr + '\\.?(?=[\\s,0-9]|$)', 'gi');
    out = out.replace(re, (m, p1) => p1 + full);
  }
  return out.replace(/\s*,\s*/g, ', ').replace(/,\s*,/g, ',').trim();
}

function stripHouseMarker(text) {
  return String(text || '')
    .replace(/^\s*(д|дом|стр|строение|корп|корпус)\.?\s*/i, '')
    .trim();
}

function parseAddressParts(address) {
  const expanded = expandAddressAbbreviations(address);
  const parts = expanded
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  let city = '';
  let house = '';
  const streetParts = [];

  for (const part of parts) {
    const cleaned = stripHouseMarker(part);
    const houseOnly = /^(\d+[а-яa-z]?(?:\s*\/\s*\d+[а-яa-z]?)?)$/i.test(cleaned);
    const withHouse = /^(.*?)[\s,]+(\d+[а-яa-z]?(?:\s*\/\s*\d+[а-яa-z]?)?)$/i.exec(cleaned);

    if (houseOnly) {
      if (!house) house = cleaned;
      continue;
    }
    if (withHouse && !house) {
      streetParts.push(withHouse[1].trim());
      house = withHouse[2].trim();
      continue;
    }
    const hint = part.toLowerCase().replace(/\.$/, '');
    if (!city && CITY_HINTS.includes(hint)) continue;
    if (!city && !house && streetParts.length === 0 && !startsWithStreetType(part)) {
      city = part.replace(/^(г|гор|город)\.?\s*/i, '').trim();
      continue;
    }
    streetParts.push(part);
  }

  let street = streetParts.join(', ');
  if (!house && /\s\d+[а-яa-z]?$/i.test(street)) {
    const m = /^(.*\S)\s+(\d+[а-яa-z]?)$/i.exec(street);
    if (m) {
      street = m[1];
      house = m[2];
    }
  }

  return { expanded, city, street, house, parts };
}

function startsWithStreetType(text) {
  const t = String(text || '').trim().toLowerCase();
  return STREET_TYPES.some((s) => t.startsWith(s));
}

function hasStreetTypeInside(text) {
  const set = new Set(words(text));
  return STREET_TYPES.some((s) => set.has(s));
}

function stripLeadingStreetType(street) {
  const t = String(street || '').trim();
  for (const type of STREET_TYPES) {
    const re = new RegExp('^' + type + '\\s+', 'i');
    if (re.test(t)) {
      const rest = t.replace(re, '').trim();
      if (rest) return rest;
    }
  }
  return t;
}

function geocodeVariants(address) {
  const parsed = parseAddressParts(address);
  const raw = String(address || '').trim();
  const variants = [];
  const seen = new Set();
  const push = (q) => {
    const v = String(q || '').trim().replace(/\s+/g, ' ');
    if (!v) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    variants.push(v);
  };

  push(raw);
  push(parsed.expanded);

  const streetNoType = stripLeadingStreetType(parsed.street);
  const streetWithHouse = parsed.house ? `${parsed.street}, ${parsed.house}` : '';
  const streetNoTypeWithHouse = parsed.house ? `${streetNoType}, ${parsed.house}` : '';

  if (parsed.street && parsed.city) {
    if (streetWithHouse) push(`${streetWithHouse}, ${parsed.city}`);
    if (streetNoTypeWithHouse) push(`${streetNoTypeWithHouse}, ${parsed.city}`);
    push(`${parsed.city}, ${streetWithHouse}`);
    push(`${parsed.city}, ${streetNoTypeWithHouse}`);
  }
  if (streetNoTypeWithHouse) push(streetNoTypeWithHouse);
  if (streetWithHouse) push(streetWithHouse);

  return variants;
}

function normalizeHouseNumber(house) {
  return String(house || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[.,]/g, '');
}

function cityMatches(displayName, city) {
  const cityWords = words(city);
  if (!cityWords.length) return true;
  const dnWords = new Set(words(displayName));
  return cityWords.every((w) => dnWords.has(w));
}

function houseMatches(displayName, house) {
  const want = normalizeHouseNumber(house);
  if (!want) return 0;
  const segments = String(displayName || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!segments.length) return -3;
  const head = normalizeHouseNumber(segments[0]);
  if (head === want) return 3;
  if (/\d/.test(segments[0])) return -3;
  const hit = segments.some((s) => normalizeHouseNumber(s) === want);
  return hit ? 3 : -3;
}

function leadingStreetType(street) {
  const t = String(street || '').trim().toLowerCase();
  for (const type of STREET_TYPES) {
    if (t === type || t.startsWith(type + ' ')) return type;
  }
  return '';
}

function streetTypeConflicts(displayName, street) {
  const want = leadingStreetType(street);
  if (!want) return false;
  const nameWords = words(streetCore(street));
  if (!nameWords.length) return false;
  const segment = String(displayName || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .find((s) => {
      const sw = new Set(words(s));
      return nameWords.every((w) => sw.has(w));
    });
  if (!segment) return false;
  const found = leadingStreetType(segment);
  if (!found) return false;
  return found !== want;
}

function streetCore(street) {
  return String(street || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(
      /^(проспект|улица|переулок|шоссе|набережная|площадь|бульвар|проезд|тракт|строение|корпус|микрорайон)\s+/i,
      ''
    )
    .trim();
}

function streetMatches(displayName, street) {
  const name = streetCore(street);
  if (!name) return true;
  const streetWords = words(name);
  if (!streetWords.length) return true;
  const dnWords = new Set(words(displayName));
  return streetWords.every((w) => dnWords.has(w));
}

function scoreMatch(displayName, parsed) {
  const dn = String(displayName || '').toLowerCase().replace(/\s+/g, ' ');
  const dnWords = new Set(words(dn));
  let score = 0;

  if (parsed.house) score += houseMatches(displayName, parsed.house);

  const cityWords = words(parsed.city);
  if (cityWords.length) {
    if (cityMatches(displayName, parsed.city)) score += 2;
    else score -= 10;
  }

  const name = streetCore(parsed.street);
  if (name) {
    const streetWords = words(name);
    const hit = streetWords.length > 0 && streetWords.every((w) => dnWords.has(w));
    if (hit) score += 2;
    else score -= 10;
  }

  return score;
}

module.exports = {
  expandAddressAbbreviations,
  parseAddressParts,
  geocodeVariants,
  scoreMatch,
  cityMatches,
  houseMatches,
  streetMatches,
  streetTypeConflicts,
  normalizeHouseNumber,
  STREET_TYPES,
};
