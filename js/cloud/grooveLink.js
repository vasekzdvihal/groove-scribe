// Turn a pasted groove link into the query string that the library stores.

const MAX_QUERY_LENGTH = 8000;

const GROOVE_PARAMS = new Set([
  'timesig',
  'div',
  'title',
  'author',
  'comments',
  'tempo',
  'swing',
  'measures',
  'metronomefreq',
  'h',
  's',
  'k',
  't1',
  't2',
  't3',
  't4',
  'stickings',
]);

const NOTE_PARAMS = new Set(['h', 's', 'k', 't1', 't2', 't3', 't4', 'stickings']);

function parameterName(pair) {
  return pair.split('=')[0].toLowerCase();
}

function extractSearch(text) {
  if (text.startsWith('?')) return text.slice(1);
  if (/^[a-z0-9]+=/i.test(text)) return text;
  return new URL(text).search.slice(1);
}

function decodeTitle(pairs) {
  const titlePair = pairs.find((pair) => parameterName(pair) === 'title');
  if (!titlePair) return '';
  const value = titlePair.slice(titlePair.indexOf('=') + 1);
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

function isShortLink(text) {
  try {
    const url = new URL(text);
    return url.hostname.endsWith('gscribe.com') && url.pathname.startsWith('/share/');
  } catch {
    return false;
  }
}

/**
 * Read a full groove link, a bare query string, or a known short link.
 *
 * Only groove parameters survive, so that flags such as Debug or GDB_Author in a
 * pasted link never reach the stored groove.
 *
 * @param {string} text  What the user pasted.
 * @returns {{ok: true, query: string, title: string} |
 *           {ok: false, reason: 'short-link'|'not-a-groove'|'too-long'}}
 */
export function parseGrooveLink(text) {
  const trimmed = (text ?? '').trim();
  if (isShortLink(trimmed)) return { ok: false, reason: 'short-link' };

  let search;
  try {
    search = extractSearch(trimmed);
  } catch {
    return { ok: false, reason: 'not-a-groove' };
  }

  const pairs = search.split('&').filter((pair) => GROOVE_PARAMS.has(parameterName(pair)));
  if (!pairs.some((pair) => NOTE_PARAMS.has(parameterName(pair)))) {
    return { ok: false, reason: 'not-a-groove' };
  }

  const query = '?' + pairs.join('&');
  if (query.length > MAX_QUERY_LENGTH) return { ok: false, reason: 'too-long' };
  return { ok: true, query, title: decodeTitle(pairs).slice(0, 200) };
}
