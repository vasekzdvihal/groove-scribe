import { describe, it, expect, beforeEach } from 'vitest';
import { loadGrooves, newGrooveUtils } from '../helpers/legacyLoader.js';

// The built-in groove library (grooves.js) is a set of shareable groove URLs
// surfaced in the app's menu. This suite asserts the library's shape and, more
// importantly, that every shipped groove is parseable by GrooveUtils -- a strong
// end-to-end regression guard tying the data file to the parser.
describe('Built-in groove library', () => {
  let grooves;
  let gu;

  const CATEGORIES = ['Rock_Grooves', 'Triplet_Grooves', 'World_Grooves', 'Foot_Ostinatos'];

  beforeEach(async () => {
    grooves = await loadGrooves();
    gu = await newGrooveUtils();
  });

  it('exposes the expected groove categories', () => {
    for (const cat of CATEGORIES) {
      expect(grooves[cat], `missing category ${cat}`).toBeTypeOf('object');
      expect(Object.keys(grooves[cat]).length).toBeGreaterThan(0);
    }
  });

  // Build a flat list of [category, name, url] for data-driven assertions.
  const collectGrooves = (grv) =>
    CATEGORIES.flatMap((cat) =>
      Object.entries(grv[cat]).map(([name, url]) => ({ cat, name, url }))
    );

  it('has every groove URL start with a query marker', () => {
    for (const { cat, name, url } of collectGrooves(grooves)) {
      expect(url.startsWith('?'), `${cat} / ${name}`).toBe(true);
    }
  });

  it('parses every shipped groove into valid, non-empty note data', () => {
    for (const { cat, name, url } of collectGrooves(grooves)) {
      const gd = gu.getGrooveDataFromUrlString(url);
      const label = `${cat} / ${name}`;
      expect(gd, label).toBeTruthy();
      expect(gd.numberOfMeasures, label).toBeGreaterThanOrEqual(1);
      expect(gd.notesPerMeasure, label).toBeGreaterThan(0);
      // Every voice array should span all measures at the full note width.
      const expectedLen = gd.notesPerMeasure * gd.numberOfMeasures;
      expect(gd.hh_array.length, label).toBe(expectedLen);
      expect(gd.snare_array.length, label).toBe(expectedLen);
      expect(gd.kick_array.length, label).toBe(expectedLen);
    }
  });
});

// The grooves.js helper functions build the menu HTML shown in the app.
describe('groove library HTML helpers', () => {
  let grooves;
  beforeEach(async () => {
    ({ grooves } = { grooves: await loadGrooves() });
  });

  describe('isArray', () => {
    it('treats a category object as an "array" (nested group)', () => {
      expect(grooves.isArray(grooves.Rock_Grooves)).toBe(true);
      expect(grooves.isArray(grooves.FullArray)).toBe(true);
    });

    it('treats a groove URL string as a leaf (not a group)', () => {
      expect(grooves.isArray('?TimeSig=4/4&Div=16')).toBe(false);
    });
  });

  describe('FullArray', () => {
    it('groups all four categories under display names', () => {
      expect(Object.keys(grooves.FullArray)).toEqual([
        'Rock grooves',
        'Triplet grooves',
        'World grooves',
        'Foot Ostinatos',
      ]);
    });
  });

  describe('arrayAsHTMLList / getGroovesAsHTML', () => {
    it('renders a heading and a <ul> per category, with a button in each groove item', () => {
      const html = grooves.getGroovesAsHTML();
      expect(html.startsWith('<h3 class="grooveListHeader">')).toBe(true);
      expect(html).toContain('<h3 class="grooveListHeader">Rock grooves</h3>');
      expect(html).toContain('<ul class="grooveListUL">');
      // A list inside a list is not valid markup for the list rules of a screen reader.
      expect(html).not.toMatch(/<ul[^>]*>\s*<ul/);
      expect(html).toContain('class="grooveListLI"');
      expect(html).toMatch(
        /<li class="grooveListLI" data-groove="[^"]*"><button type="button" class="grooveListButton">/
      );
      // Each leaf carries its URL. The editor handles the click, so it can ask first when
      // the groove has unsaved edits.
      expect(html).toContain('data-groove="?TimeSig=4/4&amp;Div=');
      expect(html).not.toContain('onClick');
    });

    it('emits one clickable item per shipped groove plus one header per category', () => {
      const html = grooves.getGroovesAsHTML();
      const CATEGORIES = ['Rock_Grooves', 'Triplet_Grooves', 'World_Grooves', 'Foot_Ostinatos'];
      const grooveCount = CATEGORIES.reduce((n, c) => n + Object.keys(grooves[c]).length, 0);
      const leafItems = (html.match(/class="grooveListLI"/g) || []).length;
      const headerItems = (html.match(/class="grooveListHeader"/g) || []).length;
      expect(leafItems).toBe(grooveCount);
      expect(headerItems).toBe(CATEGORIES.length);
    });
  });
});
