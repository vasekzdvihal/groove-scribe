import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { newGrooveWriter, buildFullPageDOM } from '../helpers/loadGrooveWriter.js';
import { installMidiGlobal } from '../helpers/legacyLoader.js';

// Part play in the editor: the writer holds a beat selection, shades it on the grid and
// plays only those beats.

// A 4-bar 4/4 groove in 16ths. Each bar has its own notes, so the MIDI of each bar differs.
const H = '|x-x-x-x-x-x-x-x-|xxxxxxxxxxxxxxxx|x---x---x---x---|x-x-x-x-x-x-x-x-|';
const S = '|----O-------O---|--O---O---O---O-|----O-------O---|O-O-O-O-O-O-O-O-|';
const K = '|o-------o-------|o--o--o--o--o---|o-o-o-o-o-o-o-o-|o---------------|';
const FOUR_BARS = `?TimeSig=4/4&Div=16&Tempo=80&Measures=4&H=${H}&S=${S}&K=${K}`;
const bar = (lane, n) => '|' + lane.split('|')[n + 1] + '|';
// Bar 2 of FOUR_BARS as a groove of its own.
const BAR_TWO = `?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=${bar(H, 1)}&S=${bar(S, 1)}&K=${bar(K, 1)}`;
const BAR_TWO_NO_SNARE = `?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=${bar(H, 1)}&S=|----------------|&K=${bar(K, 1)}`;

const ev = { target: {}, preventDefault() {}, stopPropagation() {} };

function makeMidiMock() {
  return {
    Player: {
      playing: false,
      currentTime: 0,
      endTime: 0,
      start: vi.fn(),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      loop: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      loadFile: vi.fn((url, cb) => cb && cb()),
      ctx: { resume: vi.fn() },
    },
    loadPlugin: vi.fn((opts) => opts && opts.callback && opts.callback()),
    programChange: vi.fn(),
    setVolume: vi.fn(),
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    WebAudio: { noteOn: vi.fn() },
    AudioTag: { noteOn: vi.fn() },
    USE_XHR: false,
  };
}

function addMenusAndPopups() {
  const extra = document.createElement('div');
  extra.innerHTML =
    '<div id="timeSigPopup"><input id="timeSigPopupTimeSigTop"><input id="timeSigPopupTimeSigBottom"></div>' +
    '<button id="addMeasureButton"></button>';
  document.body.appendChild(extra);
}

const selectedCells = () =>
  [...document.querySelectorAll('.bg-highlight.is-part-selected')].map((el) =>
    Number(el.id.replace('bg-highlight', ''))
  );
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

let gw;
// Build the MIDI the player loads, the same way a play or a loop does.
const playedMidi = (playStarting = false) => {
  gw.myGrooveUtils.midiEventCallbacks.loadMidiDataEvent(gw, playStarting);
  return String(globalThis.MIDI.Player.loadFile.mock.calls.at(-1)[0]);
};
const changeTimeSig = (top, bottom) => {
  document.getElementById('timeSigPopupTimeSigTop').value = String(top);
  document.getElementById('timeSigPopupTimeSigBottom').value = String(bottom);
  gw.timeSigPopupClose('ok');
};

beforeEach(async () => {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
  globalThis.MIDI = makeMidiMock();
  await installMidiGlobal();
  gw = await newGrooveWriter();
  buildFullPageDOM(gw, 1);
  addMenusAndPopups();
  Element.prototype.scrollIntoView = vi.fn();
  // The 5th bar shows a "not for whole scores" alert.
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  gw.runsOnPageLoad();
  gw.loadNewGroove(FOUR_BARS);
});

afterEach(() => {
  delete globalThis.MIDI;
  vi.restoreAllMocks();
});

describe('setPartPlay and the shade', () => {
  it('shades only the cells of the selected beats', () => {
    gw.setPartPlay({ first: 4, last: 7 });
    expect(gw.getPartPlay()).toEqual({ first: 4, last: 7 });
    expect(selectedCells()).toEqual(range(16, 31));
  });

  it('removes the shade on null', () => {
    gw.setPartPlay({ first: 4, last: 7 });
    gw.setPartPlay(null);
    expect(gw.getPartPlay()).toBeNull();
    expect(selectedCells()).toEqual([]);
  });

  it.each([
    ['reversed', { first: 7, last: 4 }],
    ['not whole beats', { first: 1.5, last: 3 }],
    ['before the groove', { first: -1, last: 3 }],
    ['after the groove', { first: 12, last: 16 }],
  ])('stores null for a range that is %s', (_name, bad) => {
    gw.setPartPlay(bad);
    expect(gw.getPartPlay()).toBeNull();
    expect(selectedCells()).toEqual([]);
  });

  it('stores null while a permutation is active', () => {
    gw.loadNewGroove(BAR_TWO);
    gw.permutationPopupClick('kick_16ths');
    gw.setPartPlay({ first: 0, last: 1 });
    expect(gw.getPartPlay()).toBeNull();
  });

  it('tells the listener about each change', () => {
    const listener = vi.fn();
    gw.onPartPlayChange = listener;
    gw.setPartPlay({ first: 4, last: 7 });
    gw.setPartPlay(null);
    expect(listener.mock.calls).toEqual([[{ first: 4, last: 7 }], [null]]);
  });

  it('marks the MIDI as changed, so a loop picks up the selection', () => {
    gw.myGrooveUtils.midiResetNoteHasChanged();
    gw.setPartPlay({ first: 4, last: 7 });
    expect(gw.myGrooveUtils.midiEventCallbacks.noteHasChangedSinceLastDataLoad).toBe(true);
  });
});

describe('partPlayShape', () => {
  it('describes the groove and shows the ruler', () => {
    expect(gw.partPlayShape()).toEqual({
      numBeats: 4,
      numberOfMeasures: 4,
      notesPerMeasure: 16,
      rulerShown: true,
    });
  });

  it('hides the ruler and marks the grid during a permutation', () => {
    gw.permutationPopupClick('snare_16ths');
    expect(gw.partPlayShape().rulerShown).toBe(false);
    expect(document.getElementById('measureContainer').classList.contains('has-permutation')).toBe(
      true
    );
    gw.permutationPopupClick('none');
    expect(gw.partPlayShape().rulerShown).toBe(true);
    expect(document.getElementById('measureContainer').classList.contains('has-permutation')).toBe(
      false
    );
  });

  it('hides the ruler when a bar does not split into whole beats', () => {
    // 6/8 in 8th triplets: 9 notes in a bar of 6 beats.
    gw.loadNewGroove('?TimeSig=6/8&Div=12&Tempo=80&Measures=1&H=|x--------|');
    expect(gw.notesPerMeasure() % 6).not.toBe(0);
    expect(gw.partPlayShape().rulerShown).toBe(false);
    gw.setPartPlay({ first: 0, last: 1 });
    expect(gw.getPartPlay()).toBeNull();
  });
});

describe('the part MIDI', () => {
  it('plays only the notes of bar 2', () => {
    gw.setPartPlay({ first: 4, last: 7 });
    const part = playedMidi();
    gw.loadNewGroove(BAR_TWO);
    expect(part).toBe(playedMidi());
  });

  it('builds only the slots of the selected beats, over a bar line too', () => {
    const build = vi.spyOn(gw.myGrooveUtils, 'MIDI_from_HH_Snare_Kick_Arrays');
    gw.setPartPlay({ first: 3, last: 5 }); // bar 1 beat 4 to bar 2 beat 2
    playedMidi();
    // 4/4 in 16ths reads into 32 slots a bar: 8 slots a beat.
    expect(build.mock.calls.map((call) => call[12])).toEqual([
      { from: 24, to: 32 },
      { from: 0, to: 16 },
    ]);
    expect(build.mock.calls[1][2]).not.toEqual(build.mock.calls[0][2]); // bar 2 snare
  });

  it('saves the whole groove as a MIDI file, also with a selection', () => {
    const build = vi.spyOn(gw.myGrooveUtils, 'MIDI_from_HH_Snare_Kick_Arrays');
    gw.setPartPlay({ first: 4, last: 7 });
    gw.MIDISaveAs(); // jsdom logs that it does not navigate to the data: URL
    expect(build.mock.calls.map((call) => call[12] ?? null)).toEqual([null, null, null, null]);
  });

  it('plays the whole groove again with null', () => {
    const today = playedMidi();
    gw.setPartPlay({ first: 4, last: 7 });
    expect(playedMidi()).not.toBe(today);
    gw.setPartPlay(null);
    expect(playedMidi()).toBe(today);
  });

  it('keeps a muted snare muted in the part', () => {
    gw.muteInstrument('snare', 2, true);
    gw.setPartPlay({ first: 4, last: 7 });
    const part = playedMidi();
    gw.loadNewGroove(BAR_TWO_NO_SNARE);
    expect(part).toBe(playedMidi());
  });

  it('maps the playhead into the groove for a part, and not for the whole groove', () => {
    gw.setPartPlay({ first: 5, last: 7 });
    playedMidi();
    expect(gw.myGrooveUtils.mapPlaybackPercent(0)).toBe(5 / 16);
    expect(gw.myGrooveUtils.mapPlaybackPercent(1)).toBe(8 / 16);
    gw.setPartPlay(null);
    playedMidi();
    expect(gw.myGrooveUtils.mapPlaybackPercent).toBeNull();
  });

  it('counts in with the beats before the selection in its bar', () => {
    gw.metronomeOptionsMenuPopupClick('CountIn');
    gw.setPartPlay({ first: 5, last: 7 });
    const countIn = playedMidi(true);
    expect(countIn).toBe(gw.myGrooveUtils.MIDI_build_midi_url_count_in_track(4, 4, 1));
    expect(gw.myGrooveUtils.mapPlaybackPercent).toBeNull();
    playedMidi(false);
    expect(gw.myGrooveUtils.mapPlaybackPercent(0)).toBe(5 / 16);
  });

  it('counts in one plain bar without a selection', () => {
    gw.metronomeOptionsMenuPopupClick('CountIn');
    expect(playedMidi(true)).toBe(gw.myGrooveUtils.MIDI_build_midi_url_count_in_track(4, 4));
  });
});

describe('what clears the selection', () => {
  const listener = vi.fn();
  beforeEach(() => {
    gw.setPartPlay({ first: 4, last: 7 });
    listener.mockReset();
    gw.onPartPlayChange = listener;
  });
  it.each([
    ['on loadNewGroove, also of a groove with the same shape', () => gw.loadNewGroove(FOUR_BARS)],
    ['when a bar is added', () => gw.addMeasureButtonClick(ev)],
    ['when a bar is removed', () => gw.closeMeasureButtonClick(4)],
    ['when the division changes', () => gw.changeDivision(8)],
    ['when the time signature changes', () => changeTimeSig(3, 4)],
    ['when a permutation is chosen', () => gw.permutationPopupClick('kick_16ths')],
    [
      'when a permutation is chosen on a groove of one bar',
      () => {
        gw.loadNewGroove(BAR_TWO);
        gw.setPartPlay({ first: 1, last: 2 });
        listener.mockReset();
        gw.permutationPopupClick('snare_16ths');
      },
    ],
    [
      'on undo of an added bar',
      () => {
        gw.setPartPlay(null);
        gw.addMeasureButtonClick(ev);
        gw.setPartPlay({ first: 16, last: 19 });
        listener.mockReset();
        gw.undoCommand();
        expect(gw.numberOfMeasures()).toBe(4);
      },
    ],
  ])('clears %s', (_name, action) => {
    action();
    expect(gw.getPartPlay()).toBeNull();
    expect(selectedCells()).toEqual([]);
    expect(listener).toHaveBeenCalledWith(null);
  });
});

describe('what keeps the selection', () => {
  beforeEach(() => {
    gw.setPartPlay({ first: 4, last: 7 });
  });

  it('keeps it on a note click', () => {
    gw.noteLeftClick(ev, 'kick', 20);
    expect(gw.getPartPlay()).toEqual({ first: 4, last: 7 });
    expect(selectedCells()).toEqual(range(16, 31));
  });

  it('keeps it on undo of a note click', () => {
    gw.noteLeftClick(ev, 'kick', 20);
    gw.undoCommand();
    expect(gw.getPartPlay()).toEqual({ first: 4, last: 7 });
    expect(selectedCells()).toEqual(range(16, 31));
  });
});

describe('the playhead and the shade', () => {
  it('does not write a transparent background over the shade when the playhead moves on', () => {
    gw.setPartPlay({ first: 4, last: 7 });
    const cell = document.getElementById('bg-highlight16');
    gw.myGrooveUtils.midiEventCallbacks.notePlaying(gw, 'hi-hat', 16 / 64);
    expect(cell.style.background).not.toBe('');
    gw.myGrooveUtils.midiEventCallbacks.notePlaying(gw, 'hi-hat', 17 / 64);
    expect(cell.style.background).toBe('');
    gw.myGrooveUtils.midiEventCallbacks.notePlaying(gw, 'hi-hat', -1);
    expect(document.getElementById('bg-highlight17').style.background).toBe('');
    expect(cell.classList.contains('is-part-selected')).toBe(true);
  });
});
