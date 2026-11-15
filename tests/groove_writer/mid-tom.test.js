import { describe, it, expect, beforeEach, vi } from 'vitest';
import { newGrooveWriter, buildFullPageDOM } from '../helpers/loadGrooveWriter.js';

// The Mid tom row (lane T2) through edits, bar changes, menus and Clear all.

const lane = (note, at, len = 16) => `|${'-'.repeat(at)}${note}${'-'.repeat(len - 1 - at)}|`;
const groove = (toms, measures = 1) =>
  `?TimeSig=4/4&Div=16&Tempo=80&Measures=${measures}` +
  `&H=${lane('-', 0).repeat(measures).replace(/\|\|/g, '|')}` +
  `&S=${lane('-', 0).repeat(measures).replace(/\|\|/g, '|')}` +
  `&K=${lane('-', 0).repeat(measures).replace(/\|\|/g, '|')}` +
  toms;
const ev = { target: {}, preventDefault() {}, stopPropagation() {} };

function addMenusAndPopups() {
  const extra = document.createElement('div');
  extra.innerHTML =
    '<ul id="tom2ContextMenu"></ul><ul id="tom2LabelContextMenu"></ul>' +
    '<div id="timeSigPopup"><input id="timeSigPopupTimeSigTop"><input id="timeSigPopupTimeSigBottom"></div>' +
    '<button id="addMeasureButton"></button>';
  document.body.appendChild(extra);
}

const midTomOn = (i) => document.getElementById('tom2-' + i).hasAttribute('data-on');
const midTomNotes = (gw) =>
  gw
    .grooveDataFromClickableUI()
    .toms_array[1].map((n, i) => (n ? i : -1))
    .filter((i) => i >= 0);

let gw;
beforeEach(async () => {
  document.body.innerHTML = '';
  // A test that changes the groove writes the URL, and a new writer reads Div from it.
  window.history.replaceState(null, '', '/');
  globalThis.MIDI = { WebAudio: { noteOn: vi.fn() }, AudioTag: { noteOn: vi.fn() } };
  gw = await newGrooveWriter();
  buildFullPageDOM(gw, 1);
  addMenusAndPopups();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('Mid tom notes survive bar changes', () => {
  it('keeps Mid tom notes when a bar is added', () => {
    gw.loadNewGroove(groove(`&T2=${lane('o', 2)}`));
    gw.addMeasureButtonClick(ev);
    expect(gw.numberOfMeasures()).toBe(2);
    expect(midTomNotes(gw)).toEqual([2, 18]); // the new bar copies the last one
  });

  it('keeps Mid tom notes when a bar is removed', () => {
    gw.loadNewGroove(groove(`&T2=|${'-'.repeat(16)}|--o-------------|`, 2));
    expect(midTomNotes(gw)).toEqual([18]);
    gw.closeMeasureButtonClick(1);
    expect(gw.numberOfMeasures()).toBe(1);
    expect(midTomNotes(gw)).toEqual([2]);
  });

  it('keeps Mid tom notes inside the new bar length when the time signature changes', () => {
    gw.loadNewGroove(groove(`&T2=${lane('o', 2)}`));
    document.getElementById('timeSigPopupTimeSigTop').value = '3';
    document.getElementById('timeSigPopupTimeSigBottom').value = '4';
    gw.timeSigPopupClose('ok');
    expect(gw.notesPerMeasure()).toBe(12);
    expect(midTomNotes(gw)).toEqual([2]);
  });

  it('keeps Mid tom notes on 8th positions when the division changes to 8ths', () => {
    gw.loadNewGroove(groove(`&T2=${lane('o', 4)}`));
    gw.changeDivision(8);
    expect(gw.notesPerMeasure()).toBe(8);
    expect(midTomNotes(gw)).toEqual([2]);
  });
});

describe('Mid tom menus and Clear all', () => {
  it('opens the Mid tom label menu, and "all on" fills the Mid tom row of that bar', () => {
    gw.showHideToms(true, true, true);
    gw.noteLabelClick(ev, 'tom2', 1);
    expect(document.getElementById('tom2LabelContextMenu').style.display).toBe('block');
    gw.noteLabelPopupClick('tom2', 'all_on');
    expect(midTomNotes(gw)).toHaveLength(16);
  });

  it('sets and clears a Mid tom note from its note menu', () => {
    gw.showHideToms(true, true, true);
    gw.noteRightClick(ev, 'tom2', 5);
    expect(document.getElementById('tom2ContextMenu').style.display).toBe('block');
    gw.notePopupClick('tom2', 'normal');
    expect(midTomOn(5)).toBe(true);
    gw.noteRightClick(ev, 'tom2', 5);
    gw.notePopupClick('tom2', 'off');
    expect(midTomOn(5)).toBe(false);
  });

  it('clears the Mid tom row and the kept tom 3 lane on Clear all', () => {
    gw.loadNewGroove(groove(`&T2=${lane('o', 1)}&T3=${lane('o', 2)}`));
    expect(gw.grooveDataFromClickableUI().toms_array[2][2]).toBeTruthy();
    gw.clearAllNotes();
    const gd = gw.grooveDataFromClickableUI();
    expect(gd.toms_array[1].every((n) => n === false)).toBe(true);
    expect((gd.toms_array[2] || []).some(Boolean)).toBe(false);
  });
});
