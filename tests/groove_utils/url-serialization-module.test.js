import { describe, it, expect, beforeEach } from 'vitest';
import { newGrooveUtils } from '../helpers/legacyLoader.js';
import {
  getGrooveDataFromUrlString,
  getUrlStringFromGrooveData,
} from '../../js/urlSerialization.js';

// Demonstrates the Step-2/Step-3 extraction: URL <-> grooveData serialization
// now lives in its own PURE module and can be imported directly. It no longer
// takes a GrooveUtils instance — the parser seeds a fresh GrooveData (from
// grooveData.js) and takes instance flags via an optional `config`. GrooveUtils
// delegates its own methods here, so the broader url-serialization*.test.js
// suites exercise this same code.
describe('urlSerialization module (direct import)', () => {
  let gu;
  beforeEach(async () => {
    gu = await newGrooveUtils();
  });

  const URL =
    '?TimeSig=4/4&Div=16&Tempo=90&Measures=1' +
    '&H=|xxxxxxxxxxxxxxxx|&S=|----O-------O---|&K=|o-------o-------|';

  it('parses a URL into grooveData', () => {
    const gd = getGrooveDataFromUrlString(URL);
    expect(gd.numBeats).toBe(4);
    expect(gd.noteValue).toBe(4);
    expect(gd.timeDivision).toBe(16);
    expect(gd.hh_array.filter(Boolean)).toHaveLength(16);
  });

  it('serializes grooveData back to a URL string', () => {
    const gd = getGrooveDataFromUrlString(URL);
    const out = getUrlStringFromGrooveData(gd);
    expect(out).toContain('TimeSig=4/4');
    expect(out).toContain('H=|xxxxxxxxxxxxxxxx|');
  });

  it('produces the same result as the delegating GrooveUtils methods', () => {
    const gd = getGrooveDataFromUrlString(URL);
    expect(getUrlStringFromGrooveData(gd)).toBe(gu.getUrlStringFromGrooveData(gd));
  });

  describe('bad links', () => {
    it('does not throw on a malformed percent escape in Title', () => {
      expect(() => getGrooveDataFromUrlString('?Title=100%')).not.toThrow();
      expect(getGrooveDataFromUrlString('?Title=100%').title).toBe('100%');
    });

    it('reads an unencoded + in an old link as a space and %2B as a plus', () => {
      expect(getGrooveDataFromUrlString('?Title=Rock+Roll').title).toBe('Rock Roll');
      expect(getGrooveDataFromUrlString('?Title=Rock%2BRoll').title).toBe('Rock+Roll');
    });

    it.each(['100% Funk', 'Rock+Roll', 'a=b & c', 'Čeština?'])('round-trips %s', (text) => {
      const gd = getGrooveDataFromUrlString(URL);
      gd.title = text;
      gd.author = text;
      gd.comments = text;
      const back = getGrooveDataFromUrlString(getUrlStringFromGrooveData(gd));
      expect(back.title).toBe(text);
      expect(back.author).toBe(text);
      expect(back.comments).toBe(text);
    });

    it('keeps + as the closed hi-hat in note strings', () => {
      const gd = getGrooveDataFromUrlString('?Div=16&H=|+---+---+---+---|');
      expect(gd.hh_array.filter(Boolean)).toHaveLength(4);
    });

    it('does not read a parameter without a value as the text "undefined"', () => {
      expect(getGrooveDataFromUrlString('?Title&Div=16').title).toBe('');
    });

    it.each(['abc', '', '7', '0', '-8', '999'])('turns Div=%s into 16', (div) => {
      const gd = getGrooveDataFromUrlString('?Measures=2&Div=' + div);
      expect(gd.timeDivision).toBe(16);
      expect(gd.notesPerMeasure).toBe(16);
    });

    it.each([4, 8, 12, 16, 24, 32, 48])('keeps Div=%i', (div) => {
      expect(getGrooveDataFromUrlString('?Div=' + div).timeDivision).toBe(div);
    });
  });
});
