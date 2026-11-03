import { describe, it, expect } from 'vitest';
import { parseGrooveLink } from '../../js/cloud/grooveLink.js';
import { getGrooveDataFromUrlString } from '../../js/urlSerialization.js';

const QUERY = '?TimeSig=4/4&Div=16&Title=My%20Beat&Tempo=95&Measures=1&H=|x-x-|&S=|--O-|&K=|o---|';

describe('parseGrooveLink', () => {
  it.each([
    ['full link on another host', 'https://www.mikeslessons.com/gscribe' + QUERY],
    ['GitHub Pages link', 'https://montulli.github.io/GrooveScribe/' + QUERY],
    ['bare query', QUERY],
    ['query without a question mark', QUERY.slice(1)],
    ['surrounding whitespace', `  ${QUERY}\n`],
  ])('reads a %s', (_name, input) => {
    expect(parseGrooveLink(input)).toEqual({ ok: true, query: QUERY, title: 'My Beat' });
  });

  it('keeps a groove that the editor parses to the same notes', () => {
    const encoded = QUERY.replaceAll('|', '%7C');
    const parsed = parseGrooveLink('https://example.com/' + encoded);
    expect(getGrooveDataFromUrlString(parsed.query).snare_array).toEqual(
      getGrooveDataFromUrlString(QUERY).snare_array
    );
  });

  it('removes parameters that are not part of a groove', () => {
    const result = parseGrooveLink('?Debug=1&GDB_Author=1&Mode=view&evil=x&H=|x-|');
    expect(result).toEqual({ ok: true, query: '?H=|x-|', title: '' });
  });

  it('asks for the full address when given a short link', () => {
    expect(parseGrooveLink('https://gscribe.com/share/4iXPGPLVj4tZcA6J9')).toEqual({
      ok: false,
      reason: 'short-link',
    });
  });

  it.each(['', 'hello there', 'https://example.com/', 'https://example.com/?a=1', undefined])(
    'rejects %s',
    (input) => {
      expect(parseGrooveLink(input)).toEqual({ ok: false, reason: 'not-a-groove' });
    }
  );

  it('rejects a groove above the stored size limit', () => {
    expect(parseGrooveLink('?H=|' + 'x'.repeat(8000))).toEqual({ ok: false, reason: 'too-long' });
  });

  it('keeps a title with a malformed escape', () => {
    expect(parseGrooveLink('?Title=100%&H=|x|').title).toBe('100%');
  });
});
