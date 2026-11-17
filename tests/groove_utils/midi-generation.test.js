import { describe, it, expect, beforeEach, vi } from 'vitest';
import { newGrooveUtils, installMidiGlobal } from '../helpers/legacyLoader.js';
import { coverageGrooves } from '../fixtures/coverage-grooves.js';

// Regression coverage for the MIDI-generation functions in groove_utils.js:
//   - create_MIDIURLFromGrooveData      (main entry: grooveData -> data: URL)
//   - MIDI_from_HH_Snare_Kick_Arrays     (per-measure note array -> midiTrack events)
//   - MIDI_build_midi_url_count_in_track (metronome "count-in" click track)
//   - midiEventCallbackClass             (default playback callback object)
//
// These probe the *encoding* path only (data: URL construction, event counts,
// determinism). Playback controls (start/stop/pause) need the MIDI.js Player
// runtime and are intentionally out of scope.
//
// The ABC-notation note codes below (e.g. '^g' for normal hi-hat, 'c' for
// normal snare, 'F' for normal kick, 'e' for tom 1) are taken directly from
// the constant_ABC_* definitions near the top of groove_utils.js.
describe('GrooveUtils MIDI generation', () => {
  let gu;

  beforeEach(async () => {
    await installMidiGlobal(); // sets globalThis.Midi (jsmidgen) - required before any MIDI call
    gu = await newGrooveUtils();
  });

  // Helper: build grooveData from a query-string fragment the same way the
  // app does when loading a groove from a URL.
  function grooveFromUrl(qs) {
    return gu.getGrooveDataFromUrlString(qs);
  }

  describe('create_MIDIURLFromGrooveData', () => {
    const BASIC_QS =
      '?TimeSig=4/4&Div=16&Tempo=90&Measures=1&H=|xxxxxxxxxxxxxxxx|&S=|----o-------o---|&K=|o-------o-------|';

    it('returns a data:audio/midi;base64,... URL whose decoded payload starts with the MThd MIDI header', () => {
      const gd = grooveFromUrl(BASIC_QS);
      const url = gu.create_MIDIURLFromGrooveData(gd, 0);

      expect(url.startsWith('data:audio/midi;base64,')).toBe(true);

      const base64 = url.slice('data:audio/midi;base64,'.length);
      const decoded = atob(base64);
      expect(decoded.startsWith('MThd')).toBe(true);
    });

    it('pins an exact base64 snapshot for a canonical simple 4/4 groove (Tempo=90)', () => {
      const gd = grooveFromUrl(BASIC_QS);
      const url = gu.create_MIDIURLFromGrooveData(gd, 0);

      // Observed value captured directly from a probe run against the
      // current implementation - pins the core encode path precisely.
      expect(url).toBe(
        'data:audio/midi;base64,TVRoZAAAAAYAAAABAIBNVHJrAAAAagD/UQMKLCoAwBMBiTxaAIkuWgCZKlUAmSNVIJkqVSCZKlUgmSpVIJkqVQCZJlUgmSpVIJkqVSCZKlUgmSpVAJkjVSCZKlUgmSpVIJkqVSCZKlUAmSZVIJkqVSCZKlUgmSpVH4A8WgD/LwA='
      );
    });

    it('is deterministic: the same grooveData produces an identical URL each call', () => {
      const gd = grooveFromUrl(BASIC_QS);
      const url1 = gu.create_MIDIURLFromGrooveData(gd, 0);
      const url2 = gu.create_MIDIURLFromGrooveData(gd, 0);
      expect(url2).toBe(url1);
    });

    it('produces a different URL when only the tempo changes', () => {
      const gdSlow = grooveFromUrl(BASIC_QS); // Tempo=90
      const gdFast = grooveFromUrl(BASIC_QS.replace('Tempo=90', 'Tempo=150'));
      const urlSlow = gu.create_MIDIURLFromGrooveData(gdSlow, 0);
      const urlFast = gu.create_MIDIURLFromGrooveData(gdFast, 0);
      expect(urlFast).not.toBe(urlSlow);
    });

    it('produces a different URL when the groove pattern changes', () => {
      const gdA = grooveFromUrl(BASIC_QS);
      const gdB = grooveFromUrl(
        '?TimeSig=4/4&Div=16&Tempo=90&Measures=1&H=|xxxxxxxxxxxxxxxx|&S=|--------o-------|&K=|o---------------|'
      );
      const urlA = gu.create_MIDIURLFromGrooveData(gdA, 0);
      const urlB = gu.create_MIDIURLFromGrooveData(gdB, 0);
      expect(urlB).not.toBe(urlA);
    });

    it('handles a 6/8 compound-meter groove', () => {
      const gd = grooveFromUrl(
        '?TimeSig=6/8&Div=8&Tempo=100&Measures=1&H=|xxxxxx|&S=|--o---|&K=|o-----|'
      );
      const url = gu.create_MIDIURLFromGrooveData(gd, 0);
      expect(url.startsWith('data:audio/midi;base64,')).toBe(true);
      const decoded = atob(url.slice('data:audio/midi;base64,'.length));
      expect(decoded.startsWith('MThd')).toBe(true);
    });

    it('handles a triplet division (Div=12) without error', () => {
      const gd = grooveFromUrl(
        '?TimeSig=4/4&Div=12&Tempo=100&Measures=1&H=|xxxxxxxxxxxx|&S=|----o-------|&K=|o-----------|'
      );
      const url = gu.create_MIDIURLFromGrooveData(gd, 0);
      expect(url.startsWith('data:audio/midi;base64,')).toBe(true);
      const decoded = atob(url.slice('data:audio/midi;base64,'.length));
      expect(decoded.startsWith('MThd')).toBe(true);
    });

    it('handles multiple measures, producing a longer encoded track than a single measure', () => {
      const single = grooveFromUrl(BASIC_QS);
      const double = grooveFromUrl(
        '?TimeSig=4/4&Div=16&Tempo=90&Measures=2&H=|xxxxxxxxxxxxxxxx|xxxxxxxxxxxxxxxx|&S=|----o-------o---|----o-------o---|&K=|o-------o-------|o-------o-------|'
      );
      expect(double.numberOfMeasures).toBe(2);

      const urlSingle = gu.create_MIDIURLFromGrooveData(single, 0);
      const urlDouble = gu.create_MIDIURLFromGrooveData(double, 0);

      expect(urlDouble.startsWith('data:audio/midi;base64,')).toBe(true);
      // Two measures of notes encode to strictly more bytes than one measure.
      expect(urlDouble.length).toBeGreaterThan(urlSingle.length);
    });

    it('produces a different URL when non-zero swing is applied', () => {
      const gdNoSwing = grooveFromUrl(BASIC_QS);
      const gdSwing = grooveFromUrl(BASIC_QS + '&Swing=62');
      expect(gdSwing.swingPercent).toBe(62);

      const urlNoSwing = gu.create_MIDIURLFromGrooveData(gdNoSwing, 0);
      const urlSwing = gu.create_MIDIURLFromGrooveData(gdSwing, 0);
      expect(urlSwing).not.toBe(urlNoSwing);
    });

    it('produces a different URL when a non-zero metronome frequency is set', () => {
      const gdNoMetro = grooveFromUrl(BASIC_QS);
      const gdMetro = grooveFromUrl(BASIC_QS + '&MetronomeFreq=8');
      expect(gdMetro.metronomeFrequency).toBe(8);

      const urlNoMetro = gu.create_MIDIURLFromGrooveData(gdNoMetro, 0);
      const urlMetro = gu.create_MIDIURLFromGrooveData(gdMetro, 0);
      expect(urlMetro).not.toBe(urlNoMetro);
    });

    it('produces a valid, different URL for a groove that includes toms', () => {
      const gdNoToms = grooveFromUrl(BASIC_QS);
      const gdToms = grooveFromUrl(BASIC_QS + '&T1=|o---------------|');
      expect(gdToms.showToms).toBe(true);

      const urlNoToms = gu.create_MIDIURLFromGrooveData(gdNoToms, 0);
      const urlToms = gu.create_MIDIURLFromGrooveData(gdToms, 0);

      expect(urlToms.startsWith('data:audio/midi;base64,')).toBe(true);
      const decoded = atob(urlToms.slice('data:audio/midi;base64,'.length));
      expect(decoded.startsWith('MThd')).toBe(true);
      expect(urlToms).not.toBe(urlNoToms);
    });
  });

  describe('MIDI_from_HH_Snare_Kick_Arrays', () => {
    // ABC note codes used below:
    //   '^g' = normal hi-hat, 'c' = normal snare, 'F' = normal kick, 'e' = tom 1
    it('adds MIDI events to the track for a small hh/snare/kick pattern', () => {
      const midiTrack = new globalThis.Midi.Track();
      expect(midiTrack.events).toHaveLength(0);

      const HH = ['^g', false, '^g', false];
      const Snare = [false, false, 'c', false];
      const Kick = ['F', false, false, false];

      gu.MIDI_from_HH_Snare_Kick_Arrays(
        midiTrack,
        HH,
        Snare,
        Kick,
        false,
        'general_MIDI',
        /* metronome_frequency */ 0,
        /* num_notes */ 4,
        /* num_notes_for_swing */ 4,
        /* swing_percentage */ 0,
        /* timeSigTop */ 4,
        /* timeSigBottom */ 4
      );

      // Observed: 7 events - an initial blank spacer note-off, the note-off
      // for the default open-hihat placeholder + note-on for hh + note-on for
      // kick at i=0, a note-on for hh + note-on for snare at i=2, and a final
      // blank spacer note-off for trailing delay.
      expect(midiTrack.events).toHaveLength(7);
    });

    it('does not add the leading blank spacer note a second time once the track already has >= 4 events', () => {
      const midiTrack = new globalThis.Midi.Track();
      const HH = ['^g', false, false, false];
      const Snare = [false, false, false, false];
      const Kick = [false, false, false, false];

      gu.MIDI_from_HH_Snare_Kick_Arrays(
        midiTrack,
        HH,
        Snare,
        Kick,
        false,
        'general_MIDI',
        0,
        4,
        4,
        0,
        4,
        4
      );
      const lenAfterFirst = midiTrack.events.length; // 4 (observed)
      expect(lenAfterFirst).toBe(4);

      gu.MIDI_from_HH_Snare_Kick_Arrays(
        midiTrack,
        HH,
        Snare,
        Kick,
        false,
        'general_MIDI',
        0,
        4,
        4,
        0,
        4,
        4
      );
      const lenAfterSecond = midiTrack.events.length;

      // Second call only adds this call's own note events (no extra leading
      // blank spacer, since the track is no longer under 4 events).
      expect(lenAfterSecond - lenAfterFirst).toBe(3);
    });

    it('adds tom events when a Toms_Array is supplied', () => {
      const midiTrack = new globalThis.Midi.Track();
      const HH = [false, false, false, false];
      const Snare = [false, false, false, false];
      const Kick = [false, false, false, false];
      const Toms = [
        ['e', false, false, false], // Tom 1 hit on the first note
        [false, false, false, false],
        [false, false, false, false],
        [false, false, false, false],
      ];

      gu.MIDI_from_HH_Snare_Kick_Arrays(
        midiTrack,
        HH,
        Snare,
        Kick,
        Toms,
        'general_MIDI',
        0,
        4,
        4,
        0,
        4,
        4
      );

      // Observed: leading blank spacer + tom note-on + trailing blank spacer = 3.
      expect(midiTrack.events).toHaveLength(3);
    });

    it('adds metronome click events when metronome_frequency is non-zero', () => {
      const withMetronome = new globalThis.Midi.Track();
      const withoutMetronome = new globalThis.Midi.Track();
      const HH = new Array(16).fill(false);
      const Snare = new Array(16).fill(false);
      const Kick = new Array(16).fill(false);

      gu.MIDI_from_HH_Snare_Kick_Arrays(
        withMetronome,
        HH,
        Snare,
        Kick,
        false,
        'general_MIDI',
        4,
        16,
        16,
        0,
        4,
        4
      );
      gu.MIDI_from_HH_Snare_Kick_Arrays(
        withoutMetronome,
        HH,
        Snare,
        Kick,
        false,
        'general_MIDI',
        0,
        16,
        16,
        0,
        4,
        4
      );

      expect(withMetronome.events.length).toBeGreaterThan(withoutMetronome.events.length);
    });

    it('resets an out-of-range swing_percentage to 0 rather than throwing', () => {
      const midiTrack = new globalThis.Midi.Track();
      const HH = ['^g', false, '^g', false];
      const Snare = [false, false, false, false];
      const Kick = [false, false, false, false];

      // swing_percentage of 1.5 is out of the valid (0, 0.99) range; the
      // function logs a warning internally and falls back to 0 swing.
      expect(() => {
        gu.MIDI_from_HH_Snare_Kick_Arrays(
          midiTrack,
          HH,
          Snare,
          Kick,
          false,
          'general_MIDI',
          0,
          4,
          4,
          1.5,
          4,
          4
        );
      }).not.toThrow();

      // Matches the event count of the equivalent zero-swing case above.
      expect(midiTrack.events).toHaveLength(5);
    });
  });

  describe('MIDI_from_HH_Snare_Kick_Arrays with a slot range (part play)', () => {
    const METRONOME_1 = 76;
    const METRONOME_NORMAL = 77;

    // A real Midi.Track that also records each note call with its absolute time.
    // The first call (the leading blank spacer) sets no time: absolute times start after it.
    function recordingTrack() {
      const track = new globalThis.Midi.Track();
      const notes = [];
      let now = 0;
      let first = true;
      const wrap = (on, original) =>
        function (channel, pitch, time, velocity) {
          if (first) first = false;
          else now += time;
          notes.push({ on, channel, pitch, velocity, at: now });
          return original.call(track, channel, pitch, time, velocity);
        };
      track.addNoteOn = wrap(true, track.addNoteOn);
      track.addNoteOff = wrap(false, track.addNoteOff);
      track.notes = notes;
      return track;
    }

    // A full-size 4/4 bar: 32 slots, a hi-hat on every 16th, snare on 2 and 4, kick on 1 and 3.
    function fullBar() {
      const HH = new Array(32).fill(false);
      const Snare = new Array(32).fill(false);
      const Kick = new Array(32).fill(false);
      for (let i = 0; i < 32; i += 2) HH[i] = '^g';
      Snare[8] = 'c';
      Snare[24] = 'c';
      Kick[0] = 'F';
      Kick[16] = 'F';
      return { HH, Snare, Kick };
    }

    function build(track, { metronome = 8, swing = 0, slotRange } = {}) {
      const { HH, Snare, Kick } = fullBar();
      gu.MIDI_from_HH_Snare_Kick_Arrays(
        track,
        HH,
        Snare,
        Kick,
        false,
        'general_MIDI',
        metronome,
        32,
        16,
        swing,
        4,
        4,
        slotRange
      );
      return track.notes;
    }

    const noteOns = (notes) => notes.filter((n) => n.on);
    const clicks = (notes) =>
      noteOns(notes).filter((n) => n.pitch === METRONOME_1 || n.pitch === METRONOME_NORMAL);

    it('a slot range gives the same events as the same slots of a full bar', () => {
      const full = noteOns(build(recordingTrack(), { swing: 0.3 }));
      const part = noteOns(
        build(recordingTrack(), { swing: 0.3, slotRange: { from: 16, to: 32 } })
      );

      const tail = full.slice(full.length - part.length);
      // Slot 16 starts after 16 slots of 16 ticks; swing only moves notes inside a beat.
      expect(tail[0].at).toBeCloseTo(256, 6);
      expect(part[0].at).toBe(0);
      expect(part.length).toBeLessThan(full.length);
      part.forEach((n, k) => {
        expect(n.pitch).toBe(tail[k].pitch);
        expect(n.velocity).toBe(tail[k].velocity);
        expect(n.at).toBeCloseTo(tail[k].at - tail[0].at, 6);
      });
    });

    it('a range that starts on beat 3 clicks beat 3 as a normal click', () => {
      const part = build(recordingTrack(), { metronome: 4, slotRange: { from: 16, to: 32 } });
      expect(clicks(part).map((n) => n.pitch)).toEqual([METRONOME_NORMAL, METRONOME_NORMAL]);
      expect(clicks(part)[0].at).toBe(0);
    });

    it('a range with the click on the & keeps the offset', () => {
      gu.metronomeOffsetClickStart = 'AND';
      const part = build(recordingTrack(), { metronome: 4, slotRange: { from: 16, to: 32 } });
      // With the offset, the full bar clicks on the & of each beat: slots 4 (the "1"), 12, 20
      // and 28. The range keeps slots 20 and 28 (4 slots of 16 ticks after slot 16) as normal
      // clicks; a range that counted from its own start would click the "1" on slot 20.
      expect(clicks(part).map((n) => [n.pitch, n.at])).toEqual([
        [METRONOME_NORMAL, 64],
        [METRONOME_NORMAL, 192],
      ]);
    });

    it('a range that starts on beat 1 clicks the 1', () => {
      const part = build(recordingTrack(), { metronome: 4, slotRange: { from: 0, to: 16 } });
      expect(clicks(part).map((n) => n.pitch)).toEqual([METRONOME_1, METRONOME_NORMAL]);
    });

    it('a slot range in a triplet bar keeps the triplet timing', () => {
      const HH = new Array(48).fill('^g');
      const none = new Array(48).fill(false);
      const track = recordingTrack();
      gu.MIDI_from_HH_Snare_Kick_Arrays(
        track,
        HH,
        none,
        none,
        false,
        'general_MIDI',
        0,
        48,
        12,
        0,
        4,
        4,
        { from: 12, to: 24 }
      );
      const ons = noteOns(track.notes);
      expect(ons).toHaveLength(12);
      expect(ons[1].at).toBeCloseTo(10.666, 6);
    });

    it('no range keeps the bytes', () => {
      const pinned = {
        'Swing 50 straight 16ths':
          'data:audio/midi;base64,TVRoZAAAAAYAAAABAIBNVHJrAAAAagD/UQMKLCoAwBMBiTxaAIkuWgCZKlUAmSNVMJkqVRCZKlUwmSpVEJkqVQCZFlUwmSpVEJkqVTCZKlUQmSpVAJkjVTCZKlUQmSpVMJkqVRCZKlUAmRZVMJkqVRCZKlUwmSpVD4A8WgD/LwA=',
        'Three measures triplet':
          'data:audio/midi;base64,TVRoZAAAAAYAAAABAIBNVHJrAAAA9gD/UQMKLCoAwBMBiTxaAIkuWgCZM1UAmSNVKpkzVSqZM1UqmTNVAJkWVSqZM1UAmSNVKpkzVSqZM1UqmTNVKpkzVQCZFlUAmSNVKpkzVSqZM1UqmTNVKYA8WgCJLloAmTNVAJkjVSqZM1UqmTNVKpkzVQCZFlUqmTNVAJkjVSqZM1UqmTNVKpkzVSqZM1UAmRZVAJkjVSqZM1UqmTNVKpkzVSmAPFoAiS5aAJkzVQCZI1UqmTNVKpkzVSqZM1UAmRZVKpkzVQCZI1UqmTNVKpkzVSqZM1UqmTNVAJkWVQCZI1UqmTNVKpkzVSqZM1UpgDxaAP8vAA==',
        'Metronome freq 8':
          'data:audio/midi;base64,TVRoZAAAAAYAAAABAIBNVHJrAAAAigD/UQMKLCoAwBMBiTxaAJlMeACJLloAmSpVAJkjVSCZKlUgmU14AJkqVSCZKlUgmU14AJkqVQCZFlUgmSpVIJlNeACZKlUgmSpVIJlNeACZKlUAmSNVIJkqVSCZTXgAmSpVIJkqVSCZTXgAmSpVAJkWVSCZKlUgmU14AJkqVSCZKlUfgDxaAP8vAA==',
      };
      for (const [name, url] of Object.entries(pinned)) {
        const groove = coverageGrooves.find((g) => g.name === name);
        expect(gu.create_MIDIURLFromGrooveData(grooveFromUrl(groove.url), 0), name).toBe(url);
      }
    });
  });

  describe('MIDI_build_midi_url_count_in_track', () => {
    it('lead beats add clicks after the count-in', () => {
      const addNoteOn = vi.spyOn(globalThis.Midi.Track.prototype, 'addNoteOn');
      gu.MIDI_build_midi_url_count_in_track(4, 4, 2);
      const pitches = addNoteOn.mock.calls.map((call) => call[1]);
      addNoteOn.mockRestore();
      expect(pitches).toEqual([76, 77, 77, 77, 77, 77]);
    });

    it('no lead beats keeps the bytes', () => {
      expect(gu.MIDI_build_midi_url_count_in_track(4, 4)).toBe(
        'data:audio/midi;base64,TVRoZAAAAAYAAAABAIBNVHJrAAAANgD/UQMLcbAAwBMBiTxaAJlMVYEAiUxaAJlNVYEAiU1aAJlNVYEAiU1aAJlNVYEAiU1aAP8vAA=='
      );
      expect(gu.MIDI_build_midi_url_count_in_track(4, 4, 0)).toBe(
        gu.MIDI_build_midi_url_count_in_track(4, 4)
      );
    });

    it('returns a data:audio/midi;base64,... URL starting with the MThd header', () => {
      const url = gu.MIDI_build_midi_url_count_in_track(4, 4);
      expect(url.startsWith('data:audio/midi;base64,')).toBe(true);
      const decoded = atob(url.slice('data:audio/midi;base64,'.length));
      expect(decoded.startsWith('MThd')).toBe(true);
    });

    it('is deterministic for the same time signature', () => {
      const url1 = gu.MIDI_build_midi_url_count_in_track(4, 4);
      const url2 = gu.MIDI_build_midi_url_count_in_track(4, 4);
      expect(url2).toBe(url1);
    });

    it('produces a different URL for a different time signature (different count-in length)', () => {
      const url44 = gu.MIDI_build_midi_url_count_in_track(4, 4);
      const url34 = gu.MIDI_build_midi_url_count_in_track(3, 4);
      expect(url34).not.toBe(url44);
    });
  });

  describe('midiEventCallbackClass', () => {
    it('constructs an instance carrying classRoot and the default callback methods', () => {
      const cb = new gu.midiEventCallbackClass(gu);

      expect(cb.classRoot).toBe(gu);
      expect(cb.noteHasChangedSinceLastDataLoad).toBe(false);

      // Default callback surface - all present as functions.
      for (const method of [
        'playEvent',
        'loadMidiDataEvent',
        'doesMidiDataNeedRefresh',
        'pauseEvent',
        'resumeEvent',
        'stopEvent',
        'repeatChangeEvent',
        'percentProgress',
        'notePlaying',
        'midiInitialized',
      ]) {
        expect(typeof cb[method]).toBe('function');
      }
    });

    it("doesMidiDataNeedRefresh reads root.midiEventCallbacks (the GrooveUtils singleton), not the instance's own flag", () => {
      const cb = new gu.midiEventCallbackClass(gu);

      // A freshly-constructed instance's own flag is false, and so is the
      // GrooveUtils-instance singleton created internally by `new GrooveUtils()`.
      expect(cb.doesMidiDataNeedRefresh(gu)).toBe(false);

      // midiNoteHasChanged() flips the flag on gu.midiEventCallbacks (the
      // singleton), which is what doesMidiDataNeedRefresh actually reads -
      // the standalone `cb` instance's own flag is untouched.
      gu.midiNoteHasChanged();
      expect(cb.doesMidiDataNeedRefresh(gu)).toBe(true);
      expect(cb.noteHasChangedSinceLastDataLoad).toBe(false);

      gu.midiResetNoteHasChanged();
      expect(cb.doesMidiDataNeedRefresh(gu)).toBe(false);
    });
  });
});
