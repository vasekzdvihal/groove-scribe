// View HTML builders (Step 4 extraction from groove_writer.js).
//
// Pure string builders for chunks of the editor UI: the clickable staff
// container (one measure of note cells), the permutation choice and the
// permutation-options menu. They
// hold no state — layout numbers and the note-grouping size come in via a small
// context object / arguments, so GrooveWriter (which owns that state) delegates
// its HTMLforStaffContainer / HTMLforPermutationOptions methods here.

import { constant_MAX_MEASURES } from './constants.js';
import { beatsPerBarFit } from './partPlay.js';

const INSTRUMENT_WORDS = {
  sticking: 'Sticking',
  hh: 'Hi-hat',
  tom1: 'High tom',
  tom2: 'Mid tom',
  snare: 'Snare',
  tom4: 'Floor tom',
  kick: 'Kick',
};

// The counts after the beat number, by notes per beat. The first note of a beat is the beat.
const BEAT_COUNTS = { 2: ['and'], 3: ['and', 'a'], 4: ['e', 'and', 'a'] };

/**
 * The name a screen reader says for a note cell, without its state: "Snare, beat 2",
 * "Hi-hat, beat 1 and", "Kick, bar 2, beat 4 a". A bar that does not split into whole beats
 * counts notes: "Snare, note 5".
 * @param {'sticking'|'hh'|'tom1'|'tom2'|'snare'|'tom4'|'kick'} instrument
 * @param {number} index  the global note index in the groove
 * @param {{ notesPerMeasure: number, numBeatsPerMeasure: number, numberOfMeasures: number }} ctx
 * @returns {string}
 */
export function noteCellName(instrument, index, ctx) {
  var parts = [INSTRUMENT_WORDS[instrument]];
  var noteInBar = index % ctx.notesPerMeasure;
  if (ctx.numberOfMeasures > 1) parts.push('bar ' + (Math.floor(index / ctx.notesPerMeasure) + 1));
  if (!beatsPerBarFit(ctx.notesPerMeasure, ctx.numBeatsPerMeasure)) {
    parts.push('note ' + (noteInBar + 1));
    return parts.join(', ');
  }
  var notesPerBeat = ctx.notesPerMeasure / ctx.numBeatsPerMeasure;
  var beat = 'beat ' + (Math.floor(noteInBar / notesPerBeat) + 1);
  var noteInBeat = noteInBar % notesPerBeat;
  if (noteInBeat === 0) parts.push(beat);
  else if (BEAT_COUNTS[notesPerBeat])
    parts.push(beat + ' ' + BEAT_COUNTS[notesPerBeat][noteInBeat - 1]);
  else parts.push(beat, 'note ' + (noteInBeat + 1));
  return parts.join(', ');
}

// The grid attributes of one note cell. markNoteOn in groove_writer.js keeps the state at the
// end of aria-label up to date; a new cell is off until a setter runs.
function cellAttrs(instrument, index, ctx) {
  var name = noteCellName(instrument, index, ctx);
  return (
    ' role="gridcell" tabindex="-1" data-instrument="' +
    instrument +
    '" data-index="' +
    index +
    '" data-name="' +
    name +
    '" aria-label="' +
    name +
    ', off"'
  );
}

// One tom lane (High tom = 1, Mid tom = 2, Floor tom = 4) of a bar in the note grid.
function tomLaneHTML(tomNum, baseindex, indexStartForNotes, ctx) {
  var newHTML = '';
  var i;
  newHTML +=
    '\
										<div class="toms-container" role="row" id="tom' +
    tomNum +
    '-container">\
											<div class="opening_note_space"> </div>';
  for (i = indexStartForNotes; i < ctx.notesPerMeasure + indexStartForNotes; i++) {
    newHTML +=
      '\
						<div id="tom' +
      tomNum +
      '-' +
      i +
      '" class="tom"' +
      cellAttrs('tom' + tomNum, i, ctx) +
      ' onClick="myGrooveWriter.noteLeftClick(event, \'tom' +
      tomNum +
      "', " +
      i +
      ')" oncontextmenu="event.preventDefault(); myGrooveWriter.noteRightClick(event, \'tom' +
      tomNum +
      "', " +
      i +
      ')" onmouseenter="myGrooveWriter.noteOnMouseEnter(event, \'tom' +
      tomNum +
      "', " +
      i +
      ')">\
							<div class="tom_circle note_part"  id="tom_circle' +
      tomNum +
      '-' +
      i +
      '"></div>\
						</div>\n\
						';

    if (
      (i - (indexStartForNotes - 1)) % ctx.noteGrouping === 0 &&
      i < ctx.notesPerMeasure + indexStartForNotes - 1
    ) {
      newHTML += '<div class="space_between_note_groups"> </div> \n';
    }
  }
  newHTML +=
    '<span class="unmuteTom' +
    tomNum +
    'Button" id="unmutetom' +
    tomNum +
    'Button' +
    baseindex +
    '" onClick=\'myGrooveWriter.muteInstrument("tom' +
    tomNum +
    '", ' +
    baseindex +
    ', false)\'><span class="fa-stack unmuteStack"><i class="fa fa-ban fa-stack-2x" style="color:red"></i><i class="fa fa-volume-down fa-stack-1x"></i></span>';
  newHTML += '<div class="end_note_space"></div>\n</div>\n';
  return newHTML;
}

/**
 * The part play ruler of one bar, in the header row above it: "Bar N" over the label column,
 * then one beat per beat over the cells. It has the same flex parts as the lanes (opening
 * space, group gaps, end space), and each beat is as wide as its cells, so each beat lines up
 * with its cells. No ruler when the bar does not split into whole beats.
 * @param {number} baseindex  the 1-based bar number
 * @param {{ notesPerMeasure: number, numBeatsPerMeasure: number, noteGrouping: number }} ctx
 * @returns {string}
 */
function barRulerHTML(baseindex, ctx) {
  var numBeats = ctx.numBeatsPerMeasure;
  if (!beatsPerBarFit(ctx.notesPerMeasure, numBeats)) return '';
  var notesPerBeat = ctx.notesPerMeasure / numBeats;
  var bar = baseindex - 1;
  var html =
    '<div class="bar-ruler" data-bar="' +
    bar +
    '"><button type="button" class="bar-ruler-bar" title="Play only bar ' +
    baseindex +
    '">Bar ' +
    baseindex +
    '</button><div class="bar-ruler-beats" role="listbox" aria-multiselectable="true" aria-label="Beats of bar ' +
    baseindex +
    '"><div class="opening_note_space"></div>';
  for (var beat = 0; beat < numBeats; beat++) {
    var firstNote = beat * notesPerBeat;
    // The group gaps inside this beat: after each full group, except at the end of the beat.
    var innerGaps = 0;
    for (var note = firstNote + 1; note < firstNote + notesPerBeat; note++) {
      if (note % ctx.noteGrouping === 0) innerGaps++;
    }
    html +=
      '<span class="bar-ruler-beat" role="option" tabindex="-1" aria-selected="false" aria-label="Bar ' +
      baseindex +
      ', beat ' +
      (beat + 1) +
      '" data-beat="' +
      (bar * numBeats + beat) +
      '" style="--beat-cells:' +
      notesPerBeat +
      ';--beat-gaps:' +
      innerGaps +
      '"><span class="bar-ruler-track"></span><span class="bar-ruler-num">' +
      (beat + 1) +
      '</span></span>';
    var nextNote = firstNote + notesPerBeat;
    if (nextNote < ctx.notesPerMeasure && nextNote % ctx.noteGrouping === 0) {
      html += '<div class="space_between_note_groups"></div>';
    }
  }
  return html + '<div class="end_note_space"></div></div></div>';
}

export function buildStaffContainerHTML(baseindex, indexStartForNotes, ctx) {
  var newHTML =
    '\
						<div class="staff-container" id="staff-container' +
    baseindex +
    '">' +
    barRulerHTML(baseindex, ctx) +
    '\
							<div class="stickings-row-container">\
								<div class="line-labels">\
									<div class="stickings-label" onClick="myGrooveWriter.noteLabelClick(event, \'stickings\', ' +
    baseindex +
    ')" oncontextmenu="event.preventDefault(); myGrooveWriter.noteLabelClick(event, \'stickings\', ' +
    baseindex +
    ')">STICKINGS</div>\
								</div>\
								<div class="music-line-container">\n\
									\
									<div class="notes-container" role="grid" aria-label="Stickings, bar ' +
    baseindex +
    '">\n';

  newHTML +=
    '\
										<div class="stickings-container" role="row">\
											<div class="opening_note_space"> </div>';
  for (var i = indexStartForNotes; i < ctx.notesPerMeasure + indexStartForNotes; i++) {
    newHTML +=
      '\
														<div id="sticking' +
      i +
      '" class="sticking"' +
      cellAttrs('sticking', i, ctx) +
      '>\n\
															<div class="sticking_right note_part"  id="sticking_right' +
      i +
      '"  onClick="myGrooveWriter.noteLeftClick(event, \'sticking\', ' +
      i +
      ')" oncontextmenu="event.preventDefault(); myGrooveWriter.noteRightClick(event, \'sticking\', ' +
      i +
      ')" onmouseenter="myGrooveWriter.noteOnMouseEnter(event, \'sticking\', ' +
      i +
      ')">R</div>\n\
															<div class="sticking_left note_part"   id="sticking_left' +
      i +
      '"   onClick="myGrooveWriter.noteLeftClick(event, \'sticking\', ' +
      i +
      ')" oncontextmenu="event.preventDefault(); myGrooveWriter.noteRightClick(event, \'sticking\', ' +
      i +
      ')">L</div>\n\
															<div class="sticking_both note_part"   id="sticking_both' +
      i +
      '"   onClick="myGrooveWriter.noteLeftClick(event, \'sticking\', ' +
      i +
      ')" oncontextmenu="event.preventDefault(); myGrooveWriter.noteRightClick(event, \'sticking\', ' +
      i +
      ')">R/L</div>\n\
															<div class="sticking_count note_part"   id="sticking_count' +
      i +
      '"   onClick="myGrooveWriter.noteLeftClick(event, \'sticking\', ' +
      i +
      ')" oncontextmenu="event.preventDefault(); myGrooveWriter.noteRightClick(event, \'sticking\', ' +
      i +
      ')">C</div>\n\
														</div>\n\
													';

    // add space between notes, exept on the last note
    if (
      (i - (indexStartForNotes - 1)) % ctx.noteGrouping === 0 &&
      i < ctx.notesPerMeasure + indexStartForNotes - 1
    ) {
      newHTML += '<div class="space_between_note_groups"> </div>\n';
    }
  }
  newHTML += '<div class="end_note_space"></div>\n</div>\n';

  newHTML +=
    '\
									</div>\
								</div>\
							</div>\n';

  newHTML +=
    '\
							<span class="notes-row-container">\
								<div class="line-labels">\
									<div class="hh-label" onClick="myGrooveWriter.noteLabelClick(event, \'hh\', ' +
    baseindex +
    ')" oncontextmenu="event.preventDefault(); myGrooveWriter.noteLabelClick(event, \'hh\', ' +
    baseindex +
    ')">Hi-hat</div>\
									<div class="tom-label" id="tom1-label" onClick="myGrooveWriter.noteLabelClick(event, \'tom1\', ' +
    baseindex +
    ')" oncontextmenu="event.preventDefault(); myGrooveWriter.noteLabelClick(event, \'tom1\', ' +
    baseindex +
    ')">High tom</div>\
									<div class="tom-label" id="tom2-label" onClick="myGrooveWriter.noteLabelClick(event, \'tom2\', ' +
    baseindex +
    ')" oncontextmenu="event.preventDefault(); myGrooveWriter.noteLabelClick(event, \'tom2\', ' +
    baseindex +
    ')">Mid tom</div>\
									<div class="snare-label" onClick="myGrooveWriter.noteLabelClick(event, \'snare\', ' +
    baseindex +
    ')" oncontextmenu="event.preventDefault(); myGrooveWriter.noteLabelClick(event, \'snare\', ' +
    baseindex +
    ')">Snare</div>\
									<div class="tom-label" id="tom4-label" onClick="myGrooveWriter.noteLabelClick(event, \'tom4\', ' +
    baseindex +
    ')" oncontextmenu="event.preventDefault(); myGrooveWriter.noteLabelClick(event, \'tom4\', ' +
    baseindex +
    ')">Floor tom</div>\
									<div class="kick-label" onClick="myGrooveWriter.noteLabelClick(event, \'kick\', ' +
    baseindex +
    ')" oncontextmenu="event.preventDefault(); myGrooveWriter.noteLabelClick(event, \'kick\', ' +
    baseindex +
    ')">Kick</div>\
								</div>\
								<div class="music-line-container">\
									\
									<div class="notes-container" role="grid" aria-label="Notes, bar ' +
    baseindex +
    '">\
									<div class="staff-line-1"></div>\
									<div class="staff-line-2"></div>\
									<div class="staff-line-3"></div>\
									<div class="staff-line-4"></div>\
									<div class="staff-line-5"></div>\n';

  // backgrounds for highlighting.  Evenly spaced cols of space
  newHTML +=
    '\
										<div class="background-highlight-container">\
											<div class="opening_note_space"> </div>';
  for (i = indexStartForNotes; i < ctx.notesPerMeasure + indexStartForNotes; i++) {
    newHTML +=
      '						<div id="bg-highlight' +
      i +
      '" class="bg-highlight" >\
												</div>\n';

    if (
      (i - (indexStartForNotes - 1)) % ctx.noteGrouping === 0 &&
      i < ctx.notesPerMeasure + indexStartForNotes - 1
    ) {
      newHTML += '<div class="space_between_note_groups"> </div> \n';
    }
  }
  newHTML += '<div class="end_note_space"></div>\n</div>\n';

  // Hi-hats
  newHTML +=
    '\
										<div class="hi-hat-container" role="row">\
											<div class="opening_note_space"> </div>';
  for (i = indexStartForNotes; i < ctx.notesPerMeasure + indexStartForNotes; i++) {
    newHTML +=
      '\
														<div id="hi-hat' +
      i +
      '" class="hi-hat"' +
      cellAttrs('hh', i, ctx) +
      " onClick=\"myGrooveWriter.noteLeftClick(event, 'hh', " +
      i +
      ')" oncontextmenu="event.preventDefault(); myGrooveWriter.noteRightClick(event, \'hh\', ' +
      i +
      ')" onmouseenter="myGrooveWriter.noteOnMouseEnter(event, \'hh\', ' +
      i +
      ')">\
															<div class="hh_crash note_part"  id="hh_crash' +
      i +
      '"><i class="fa fa-asterisk"></i></div>\
															<div class="hh_ride note_part"   id="hh_ride' +
      i +
      '"><i class="fa fa-dot-circle-o"></i></div>\
															<div class="hh_ride_bell note_part"   id="hh_ride_bell' +
      i +
      '"><i class="fa fa-bell-o"></i></div>\
															<div class="hh_cow_bell note_part"    id="hh_cow_bell' +
      i +
      '"><i class="fa fa-plus-square-o"></i></div>\
															<div class="hh_stacker note_part"   id="hh_stacker' +
      i +
      '"><i class="fa fa-bars"></i></div>\
															<div class="hh_metronome_normal note_part"   id="hh_metronome_normal' +
      i +
      '"><i class="fa fa-neuter"></i></div>\
															<div class="hh_metronome_accent note_part"   id="hh_metronome_accent' +
      i +
      '"><i class="fa fa-map-pin"></i></div>\
															<div class="hh_cross note_part"  id="hh_cross' +
      i +
      '"><i class="fa fa-times"></i></div>\
															<div class="hh_open note_part"   id="hh_open' +
      i +
      '"><i class="fa fa-circle-o"></i></div>\
															<div class="hh_close note_part"  id="hh_close' +
      i +
      '"><i class="fa fa-plus"></i></div>\
															<div class="hh_accent note_part" id="hh_accent' +
      i +
      '"><i class="fa fa-angle-right"></i></div>\
														</div>\n\
													';

    if (
      (i - (indexStartForNotes - 1)) % ctx.noteGrouping === 0 &&
      i < ctx.notesPerMeasure + indexStartForNotes - 1
    ) {
      newHTML += '<div class="space_between_note_groups"> </div> \n';
    }
  }
  newHTML +=
    '<div class="unmuteHHButton" id="unmutehhButton' +
    baseindex +
    '" onClick=\'myGrooveWriter.muteInstrument("hh", ' +
    baseindex +
    ', false)\'><span class="fa-stack unmuteHHStack"><i class="fa fa-ban fa-stack-2x" style="color:red"></i><i class="fa fa-volume-down fa-stack-1x"></i></div>';
  newHTML += '<div class="end_note_space"></div>\n</div>\n';

  // Toms 1 and 2 (High and Mid tom)
  newHTML += tomLaneHTML(1, baseindex, indexStartForNotes, ctx);
  newHTML += tomLaneHTML(2, baseindex, indexStartForNotes, ctx);

  // Snare stuff
  newHTML +=
    '\
										<div class="snare-container" role="row">\
											<div class="opening_note_space"> </div> ';
  for (i = indexStartForNotes; i < ctx.notesPerMeasure + indexStartForNotes; i++) {
    newHTML +=
      '' +
      '<div id="snare' +
      i +
      '" class="snare"' +
      cellAttrs('snare', i, ctx) +
      " onClick=\"myGrooveWriter.noteLeftClick(event, 'snare', " +
      i +
      ')" oncontextmenu="event.preventDefault(); myGrooveWriter.noteRightClick(event, \'snare\', ' +
      i +
      ')" onmouseenter="myGrooveWriter.noteOnMouseEnter(event, \'snare\', ' +
      i +
      ')">' +
      '<div class="snare_ghost note_part"  id="snare_ghost' +
      i +
      '">(<i class="fa fa-circle dot_in_snare_ghost_note"></i>)</div>' +
      '<div class="snare_circle note_part" id="snare_circle' +
      i +
      '"></div>' +
      '<div class="snare_xstick note_part" id="snare_xstick' +
      i +
      '"><i class="fa fa-times"></i></div>' +
      '<div class="snare_buzz note_part" id="snare_buzz' +
      i +
      '"><i class="fa fa-bars"></i></div>' +
      '<div class="snare_flam note_part" id="snare_flam' +
      i +
      '"><i class="fa ">' +
      '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" width="30" height="30">' +
      '	<style type="text/css">' +
      '		.flam_fill {fill: currentColor}' +
      '		.flam_stroke {stroke: currentColor; fill: none; stroke-width: .7}' +
      '	</style>' +
      '	<defs>' +
      '		<path id="flam_ghd" class="flam_fill" d="m1.7-1c-1-1.7-4.5 0.2-3.4 2 1 1.7 4.5-0.2 3.4-2"></path>' +
      '		<ellipse id="flam_hd" rx="4.1" ry="2.9" transform="rotate(-20)" class="flam_fill"></ellipse>' +
      '	</defs>' +
      '	<g id="note" transform="translate(-44 -35)">' +
      '		<path class="flam_stroke" d="m52.1 53.34v-14M52.1 39.34c0.6 3.4 5.6 3.8 3 10 1.2-4.4-1.4-7-3-7"></path>' +
      '		<use x="50.50" y="53.34" xlink:href="#flam_ghd"></use>' +
      '		<path class="flam_stroke" d="m49.5 49.34l9-5"></path>' +
      '		<path class="flam_stroke" d="m50.5 58.34c2.9 3 11.6 3 14.5 0M69.5 53.34v-21"></path><use x="66.00" y="53.34" xlink:href="#flam_hd"></use>' +
      '	</g>' +
      '</svg>' +
      '</i></div>' +
      '<div class="snare_drag note_part" id="snare_drag' +
      i +
      '"><i class="fa ">' +
      '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" width="30" height="30">' +
      '	<style type="text/css">' +
      '		.drag_fill {fill: currentColor}' +
      '		.drag_stroke {stroke: currentColor; fill: none; stroke-width: .7}' +
      '	</style>' +
      '	<defs>' +
      '		<path id="drag_ghd" class="drag_fill" d="m1.7-1c-1-1.7-4.5 0.2-3.4 2 1 1.7 4.5-0.2 3.4-2"></path>' +
      '		<ellipse id="drag_hd" rx="4.1" ry="2.9" transform="rotate(-20)" class="drag_fill"></ellipse>' +
      '	</defs>' +
      '	<g id="note" transform="translate(-44 -35)">' +
      '       <path class="fill" d="m51.81 38.34 l8.58 0.00v1.60l-8.58 0.00"></path>' +
      '	    <path class="fill" d="m52.10 41.34 l8.00 0.00v1.60l-8.00 0.00"></path>' +
      '		<path class="drag_stroke" d="m52.1 53.34v-15.00"></path>' +
      '		<use x="50.50" y="53.34" xlink:href="#drag_ghd"></use>' +
      '		<path class="drag_stroke" d="m49.50 49.34l8.00 -15.00"></path>' +
      '		<path class="drag_stroke" d="m60.10 53.34v-15.00"></path>' +
      '		<use x="58.50" y="53.34" xlink:href="#drag_ghd"></use>' +
      '		<path class="drag_stroke" d="m50.5 58.34c2.9 3 11.6 3 14.5 0M69.5 53.34v-21"></path><use x="66.00" y="53.34" xlink:href="#drag_hd"></use>' +
      '	</g>' +
      '</svg>' +
      '</i></div>' +
      '<div class="snare_accent note_part" id="snare_accent' +
      i +
      '">' +
      '  <i class="fa fa-chevron-right"></i>' +
      '</div>' +
      '</div> \n';

    if (
      (i - (indexStartForNotes - 1)) % ctx.noteGrouping === 0 &&
      i < ctx.notesPerMeasure + indexStartForNotes - 1
    ) {
      newHTML += '<div class="space_between_note_groups"> </div> ';
    }
  }
  newHTML +=
    '<span class="unmuteSnareButton" id="unmutesnareButton' +
    baseindex +
    '" onClick=\'myGrooveWriter.muteInstrument("snare", ' +
    baseindex +
    ', false)\'><span class="fa-stack unmuteStack"><i class="fa fa-ban fa-stack-2x" style="color:red"></i><i class="fa fa-volume-down fa-stack-1x"></i></span>';
  newHTML += '<div class="end_note_space"></div>\n</div>\n';

  // Toms 4 (Floor tom)
  newHTML += tomLaneHTML(4, baseindex, indexStartForNotes, ctx);

  // Kick stuff
  newHTML +=
    '\
										<div class="kick-container" role="row">\
											<div class="opening_note_space"> </div> ';
  for (var j = indexStartForNotes; j < ctx.notesPerMeasure + indexStartForNotes; j++) {
    newHTML +=
      '\
														<div id="kick' +
      j +
      '" class="kick"' +
      cellAttrs('kick', j, ctx) +
      " onClick=\"myGrooveWriter.noteLeftClick(event, 'kick', " +
      j +
      ')" oncontextmenu="event.preventDefault(); myGrooveWriter.noteRightClick(event, \'kick\', ' +
      j +
      ')" onmouseenter="myGrooveWriter.noteOnMouseEnter(event, \'kick\', ' +
      j +
      ')">\
														<div class="kick_splash note_part" id="kick_splash' +
      j +
      '"><i class="fa fa-times"></i></div>\
														<div class="kick_circle note_part" id="kick_circle' +
      j +
      '"></div>\
														</div> \n\
													';

    if (
      (j - (indexStartForNotes - 1)) % ctx.noteGrouping === 0 &&
      j < ctx.notesPerMeasure + indexStartForNotes - 1
    ) {
      newHTML += '<div class="space_between_note_groups"> </div> ';
    }
  }
  newHTML +=
    '<span class="unmuteKickButton" id="unmutekickButton' +
    baseindex +
    '" onClick=\'myGrooveWriter.muteInstrument("kick", ' +
    baseindex +
    ', false)\'><span class="fa-stack unmuteStack"><i class="fa fa-ban fa-stack-2x" style="color:red"></i><i class="fa fa-volume-down fa-stack-1x"></i></span>';
  newHTML += '<div class="end_note_space"></div>\n</div>\n';

  newHTML +=
    '\
								</div>\
							</div>\
						</span>\n';

  if (ctx.numberOfMeasures > 1)
    newHTML +=
      '<button type="button" title="Remove bar ' +
      baseindex +
      '" aria-label="Remove bar ' +
      baseindex +
      '" id="closeMeasureButton' +
      baseindex +
      '" onClick="myGrooveWriter.closeMeasureButtonClick(' +
      baseindex +
      ')" class="closeMeasureButton"><i class="fa fa-times-circle"></i></button>';
  else
    newHTML +=
      '<span class="closeMeasureButton" aria-hidden="true"><i class="fa">&nbsp;&nbsp;&nbsp;</i></span>';

  if (baseindex == ctx.numberOfMeasures) {
    // add new measure button. At the limit the button stays (layout does not move) but is
    // disabled. aria-disabled, not disabled: the button keeps its tab stop and says the limit.
    if (ctx.numberOfMeasures >= constant_MAX_MEASURES)
      newHTML +=
        '<button type="button" id="addMeasureButton" title="Add a bar. You can have ' +
        constant_MAX_MEASURES +
        ' bars at most" aria-disabled="true" aria-label="Add a bar. You can have ' +
        constant_MAX_MEASURES +
        ' bars at most" onClick="myGrooveWriter.addMeasureButtonClick(event)"><i class="fa fa-plus"></i></button>';
    else
      newHTML +=
        '<button type="button" id="addMeasureButton" title="Add a bar" aria-label="Add a bar" onClick="myGrooveWriter.addMeasureButtonClick(event)"><i class="fa fa-plus"></i></button>';
  }

  newHTML += '</div>';

  return newHTML;
} // end function buildStaffContainerHTML

// The choices in the Permutations tab, in display order.
const PERMUTATION_CHOICES = [
  { type: 'none', label: 'None' },
  { type: 'kick_16ths', label: 'Kick' },
  { type: 'snare_16ths', label: 'Snare' },
];

/**
 * The choice in the Permutations tab of the side panel. Permutations work in 4/4 time only, so
 * another time signature gets a message and no choice.
 * @param {string} activeType  the active permutation: 'none', 'kick_16ths' or 'snare_16ths'
 * @param {boolean} isFourFour
 * @returns {string}
 */
export function buildPermutationChoiceHTML(activeType, isFourFour) {
  if (!isFourFour) return '<p>Permutations work in 4/4 time only.</p>';
  return PERMUTATION_CHOICES.map(
    ({ type, label }) =>
      `<button type="button" class="btn permutation-choice-button" data-permutation="${type}" ` +
      `aria-pressed="${type == activeType}" ` +
      `onclick="myGrooveWriter.permutationPopupClick('${type}')">${label}</button>`
  ).join('');
}

export function buildPermutationOptionsHTML(permutationType, usingTriplets) {
  if (permutationType == 'none') return '';

  var optionTypeArray = [
    {
      id: 'PermuationOptionsOstinato',
      subid: 'PermuationOptionsOstinato_sub',
      name: 'Ostinato',
      SubOptions: [],
      defaultOn: false,
    },
    {
      id: 'PermuationOptionsSingles',
      subid: 'PermuationOptionsSingles_sub',
      name: 'Singles',
      SubOptions: ['1', '&', 'a'],
      defaultOn: true,
    },
    {
      id: 'PermuationOptionsDoubles',
      subid: 'PermuationOptionsDoubles_sub',
      name: 'Doubles',
      SubOptions: ['1', '&', 'a'],
      defaultOn: true,
    },
    {
      id: 'PermuationOptionsTriples',
      subid: 'PermuationOptionsTriples_sub',
      name: 'Triples',
      SubOptions: [],
      defaultOn: true,
    },
  ];

  // change and add other options for non triplet based ostinatos
  // Most of the types have 4 sub options
  // add up beats and down beats
  // add quads
  if (!usingTriplets) {
    optionTypeArray[1].SubOptions = ['1', 'e', '&', 'a']; // singles
    optionTypeArray[2].SubOptions = ['1', 'e', '&', 'a']; // doubles
    optionTypeArray[3].SubOptions = ['1', 'e', '&', 'a']; // triples
    optionTypeArray.splice(3, 0, {
      id: 'PermuationOptionsUpsDowns',
      subid: 'PermuationOptionsUpsDowns_sub',
      name: 'Downbeats/Upbeats',
      SubOptions: ['downs', 'ups'],
      defaultOn: false,
    });
    optionTypeArray.splice(5, 0, {
      id: 'PermuationOptionsQuads',
      subid: 'PermuationOptionsQuads_sub',
      name: 'Quads',
      SubOptions: [],
      defaultOn: false,
    });
  }

  switch (permutationType) {
    case 'snare_16ths':
      optionTypeArray.splice(0, 0, {
        id: 'PermuationOptionsAccentGrid',
        subid: '',
        name: 'Use Accent Grid',
        SubOptions: [],
        defaultOn: false,
      });
      break;
    case 'kick_16ths':
      if (!usingTriplets)
        optionTypeArray.splice(0, 0, {
          id: 'PermuationOptionsSkipSomeFirstNotes',
          subid: '',
          name: 'Simplify multiple kicks',
          SubOptions: [],
          defaultOn: false,
        });
      break;
    default:
      console.log('Bad case in buildPermutationOptionsHTML()');
      break;
  }

  var newHTML = '<span id="PermutationOptionsHeader">Permutation Options</span>\n';

  newHTML += '<span class="PermutationOptionWrapper">';

  for (var optionType in optionTypeArray) {
    newHTML +=
      '' +
      '<div class="PermutationOptionGroup" id="' +
      optionTypeArray[optionType].id +
      'Group">\n' +
      '<div class="PermutationOption">\n' +
      '<input ' +
      (optionTypeArray[optionType].defaultOn ? 'checked' : '') +
      ' type="checkbox" class="myCheckbox" id="' +
      optionTypeArray[optionType].id +
      '" onClick="myGrooveWriter.permutationOptionClick(event)">' +
      '<label for="' +
      optionTypeArray[optionType].id +
      '">' +
      optionTypeArray[optionType].name +
      '</label>\n' +
      '</div>' +
      '<span class="permutationSubOptionContainer" id="' +
      optionTypeArray[optionType].subid +
      '">\n';

    var count = 0;
    for (var optionName in optionTypeArray[optionType].SubOptions) {
      count++;
      newHTML +=
        '' +
        '<span class="PermutationSubOption">\n' +
        '	<input ' +
        (optionTypeArray[optionType].defaultOn ? 'checked' : '') +
        ' type="checkbox" class="myCheckbox" id="' +
        optionTypeArray[optionType].subid +
        count +
        '" onClick="myGrooveWriter.permutationSubOptionClick(event)">' +
        '	<label for="' +
        optionTypeArray[optionType].subid +
        count +
        '">' +
        optionTypeArray[optionType].SubOptions[optionName] +
        '</label>' +
        '</span>';
    }

    newHTML += '' + '	</span>\n' + '</div>\n';
  }

  newHTML += '</span>\n';
  return newHTML;
}
