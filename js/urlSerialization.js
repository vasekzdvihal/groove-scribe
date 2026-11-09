// URL <-> grooveData serialization (Step 2 extraction from groove_utils.js).
// Pure module: it depends only on other pure modules (grooveData, musicMath,
// noteArrays) — no GrooveUtils instance. GrooveUtils delegates its
// getGrooveDataFromUrlString / getUrlStringFromGrooveData methods here, passing
// its instance flags through the parse function's `config` argument.

import { createGrooveData } from './grooveData.js';
import { constant_DEFAULT_TEMPO, constant_MAX_MEASURES } from './constants.js';
import { parseTimeSigString, calc_notes_per_measure } from './musicMath.js';
import {
  noteArraysFromURLData,
  tabLineFromAbcNoteArray,
  GetDefaultStickingsGroove,
  GetDefaultHHGroove,
  GetDefaultSnareGroove,
  GetDefaultKickGroove,
  GetDefaultTomGroove,
} from './noteArrays.js';

/** Every note division the editor offers (the division menu plus 1/4 notes). */
const VALID_DIVISIONS = [4, 8, 12, 16, 24, 32, 48];

/** The division used when a link carries a missing or unsupported Div. */
const DEFAULT_DIVISION = 16;

/**
 * Turn a Div value from a link into a supported division.
 * @param {*} value
 * @returns {number}
 */
export function parseDivision(value) {
  var division = parseInt(value, 10);
  return VALID_DIVISIONS.includes(division) ? division : DEFAULT_DIVISION;
}

/**
 * Decode a URL query value without throwing. A malformed escape such as a lone
 * % keeps the raw text instead of throwing. A + stays a plus: it is the
 * closed hi-hat in note strings.
 * @param {string|undefined} value
 * @returns {string}
 */
export function safeDecode(value) {
  if (value === undefined || value === null) return '';
  var text = String(value);
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Decode a free-text field (title, author, comments). An unencoded + in an old
 * link reads as a space; %2B reads as a plus. The + is replaced before
 * decoding, so a decoded %2B is never turned into a space.
 * @param {string|undefined} value
 * @returns {string}
 */
function decodeText(value) {
  return safeDecode(value === undefined || value === null ? '' : String(value).replace(/\+/g, ' '));
}

export function getQueryVariableFromString(variable, def_value, my_string) {
  // Tolerate query strings with or without a leading '?'. window.location.search
  // and share URLs include it; some callers (e.g. GrooveDisplay embeds) pass a
  // bare 'Name=value&...' string. Only strip the '?' when it is actually there,
  // otherwise the first parameter name loses its first character.
  var query = my_string.charAt(0) === '?' ? my_string.substring(1) : my_string;
  var vars = query.split('&');
  for (var i = 0; i < vars.length; i++) {
    var pair = vars[i].split('=');
    if (pair[0].toLowerCase() == variable.toLowerCase()) {
      return pair[1];
    }
  }
  return def_value;
}

/**
 * Parse an encoded groove URL (query string) into a {@link GrooveData}.
 *
 * @param {string} encodedURLData  The URL / query string to parse.
 * @param {{debugMode?: (boolean|number), grooveDBAuthoring?: boolean, viewMode?: boolean}} [config]
 *   Instance flags to seed the new GrooveData with (passed by GrooveUtils).
 * @returns {import('./grooveData.js').GrooveData}
 */
export function getGrooveDataFromUrlString(encodedURLData, config = {}) {
  var Stickings_string;
  var HH_string;
  var Snare_string;
  var Kick_string;
  var myGrooveData = createGrooveData(config);
  var i;

  myGrooveData.debugMode = parseInt(
    getQueryVariableFromString('Debug', myGrooveData.debugMode, encodedURLData),
    10
  );

  var timeSigArray = parseTimeSigString(
    getQueryVariableFromString('TimeSig', '4/4', encodedURLData)
  );
  myGrooveData.numBeats = timeSigArray[0];
  myGrooveData.noteValue = timeSigArray[1];

  myGrooveData.timeDivision = parseDivision(
    getQueryVariableFromString('Div', DEFAULT_DIVISION, encodedURLData)
  );
  myGrooveData.notesPerMeasure = calc_notes_per_measure(
    myGrooveData.timeDivision,
    myGrooveData.numBeats,
    myGrooveData.noteValue
  );

  myGrooveData.metronomeFrequency = parseInt(
    getQueryVariableFromString('MetronomeFreq', '0', encodedURLData),
    10
  );

  myGrooveData.numberOfMeasures = parseInt(
    getQueryVariableFromString('measures', 1, encodedURLData),
    10
  );
  if (myGrooveData.numberOfMeasures < 1 || isNaN(myGrooveData.numberOfMeasures))
    myGrooveData.numberOfMeasures = 1;
  else if (myGrooveData.numberOfMeasures > constant_MAX_MEASURES)
    myGrooveData.numberOfMeasures = constant_MAX_MEASURES;

  Stickings_string = getQueryVariableFromString('Stickings', false, encodedURLData);
  if (!Stickings_string) {
    Stickings_string = GetDefaultStickingsGroove(
      myGrooveData.notesPerMeasure,
      myGrooveData.numBeats,
      myGrooveData.noteValue,
      myGrooveData.numberOfMeasures
    );
    myGrooveData.showStickings = false;
  } else {
    myGrooveData.showStickings = true;
  }

  HH_string = getQueryVariableFromString('H', false, encodedURLData);
  if (!HH_string) {
    HH_string = GetDefaultHHGroove(
      myGrooveData.notesPerMeasure,
      myGrooveData.numBeats,
      myGrooveData.noteValue,
      myGrooveData.numberOfMeasures
    );
  }

  Snare_string = getQueryVariableFromString('S', false, encodedURLData);
  if (!Snare_string) {
    Snare_string = GetDefaultSnareGroove(
      myGrooveData.notesPerMeasure,
      myGrooveData.numBeats,
      myGrooveData.noteValue,
      myGrooveData.numberOfMeasures
    );
  }

  Kick_string = getQueryVariableFromString('K', false, encodedURLData);
  if (!Kick_string) {
    Kick_string = GetDefaultKickGroove(
      myGrooveData.notesPerMeasure,
      myGrooveData.numBeats,
      myGrooveData.noteValue,
      myGrooveData.numberOfMeasures
    );
  }

  // Get the Toms
  for (i = 0; i < 4; i++) {
    // toms are named T1, T2, T3, T4
    var Tom_string = getQueryVariableFromString('T' + (i + 1), false, encodedURLData);
    if (!Tom_string) {
      Tom_string = GetDefaultTomGroove(
        myGrooveData.notesPerMeasure,
        myGrooveData.numBeats,
        myGrooveData.noteValue,
        myGrooveData.numberOfMeasures
      );
    } else {
      myGrooveData.showToms = true;
    }

    /// the toms array index starts at zero (0) the first one is T1
    myGrooveData.toms_array[i] = noteArraysFromURLData(
      'T' + (i + 1),
      Tom_string,
      myGrooveData.notesPerMeasure,
      myGrooveData.numberOfMeasures
    );
  }

  myGrooveData.sticking_array = noteArraysFromURLData(
    'Stickings',
    Stickings_string,
    myGrooveData.notesPerMeasure,
    myGrooveData.numberOfMeasures
  );
  myGrooveData.hh_array = noteArraysFromURLData(
    'H',
    HH_string,
    myGrooveData.notesPerMeasure,
    myGrooveData.numberOfMeasures
  );
  myGrooveData.snare_array = noteArraysFromURLData(
    'S',
    Snare_string,
    myGrooveData.notesPerMeasure,
    myGrooveData.numberOfMeasures
  );
  myGrooveData.kick_array = noteArraysFromURLData(
    'K',
    Kick_string,
    myGrooveData.notesPerMeasure,
    myGrooveData.numberOfMeasures
  );

  myGrooveData.title = getQueryVariableFromString('title', '', encodedURLData);
  myGrooveData.title = decodeText(myGrooveData.title);

  myGrooveData.author = getQueryVariableFromString('author', '', encodedURLData);
  myGrooveData.author = decodeText(myGrooveData.author);

  myGrooveData.comments = getQueryVariableFromString('comments', '', encodedURLData);
  myGrooveData.comments = decodeText(myGrooveData.comments);

  myGrooveData.tempo = parseInt(
    getQueryVariableFromString('tempo', constant_DEFAULT_TEMPO, encodedURLData),
    10
  );
  if (isNaN(myGrooveData.tempo) || myGrooveData.tempo < 20 || myGrooveData.tempo > 400)
    myGrooveData.tempo = constant_DEFAULT_TEMPO;

  myGrooveData.swingPercent = parseInt(getQueryVariableFromString('swing', 0, encodedURLData), 10);
  if (
    isNaN(myGrooveData.swingPercent) ||
    myGrooveData.swingPercent < 0 ||
    myGrooveData.swingPercent > 100
  )
    myGrooveData.swingPercent = 0;

  return myGrooveData;
}

/**
 * Serialize a {@link GrooveData} back into an encoded groove URL string.
 *
 * @param {import('./grooveData.js').GrooveData} myGrooveData  The groove to serialize.
 * @param {string} [url_destination]  Optional base URL to prepend.
 * @returns {string}
 */
export function getUrlStringFromGrooveData(myGrooveData, url_destination) {
  var fullURL = window.location.protocol + '//' + window.location.host + window.location.pathname;

  if (!url_destination) {
    // then assume it is the groove writer display.  Do nothing
  } else if (url_destination == 'display') {
    // asking for the "groove_display" page
    if (fullURL.includes('index.html')) fullURL = fullURL.replace('index.html', 'GrooveEmbed.html');
    else if (fullURL.includes('/gscribe'))
      fullURL = fullURL.replace('/gscribe', '/groove/GrooveEmbed.html');
    else fullURL += 'GrooveEmbed.html';
  } else if (url_destination == 'fullGrooveScribe') {
    // asking for the full GrooveScribe link: the editor page (index.html) on the site serving this page
    fullURL =
      window.location.protocol +
      '//' +
      window.location.host +
      window.location.pathname.slice(0, window.location.pathname.lastIndexOf('/') + 1) +
      'index.html';
  }

  fullURL += '?';

  if (myGrooveData.debugMode) fullURL += 'Debug=1&';

  if (myGrooveData.viewMode) fullURL += 'Mode=view&';

  if (myGrooveData.grooveDBAuthoring) fullURL += 'GDB_Author=1&';

  fullURL += 'TimeSig=' + myGrooveData.numBeats + '/' + myGrooveData.noteValue;

  // # of notes
  fullURL += '&Div=' + myGrooveData.timeDivision;

  if (myGrooveData.title !== '') fullURL += '&Title=' + encodeURIComponent(myGrooveData.title);

  if (myGrooveData.author !== '') fullURL += '&Author=' + encodeURIComponent(myGrooveData.author);

  if (myGrooveData.comments !== '')
    fullURL += '&Comments=' + encodeURIComponent(myGrooveData.comments);

  fullURL += '&Tempo=' + myGrooveData.tempo;

  if (myGrooveData.swingPercent > 0) fullURL += '&Swing=' + myGrooveData.swingPercent;

  // # of measures
  fullURL += '&Measures=' + myGrooveData.numberOfMeasures;

  // # metronome setting
  if (myGrooveData.metronomeFrequency !== 0) {
    fullURL += '&MetronomeFreq=' + myGrooveData.metronomeFrequency;
  }

  // notes
  var total_notes = myGrooveData.notesPerMeasure * myGrooveData.numberOfMeasures;
  function tomLaneIfUsed(name, laneArray) {
    if (!laneArray || !laneArray.some((note) => note !== false && note !== undefined)) return '';
    return (
      '&' +
      name +
      '=|' +
      tabLineFromAbcNoteArray(
        name,
        laneArray,
        true,
        true,
        total_notes,
        myGrooveData.notesPerMeasure
      )
    );
  }
  var HH =
    '&H=|' +
    tabLineFromAbcNoteArray(
      'H',
      myGrooveData.hh_array,
      true,
      true,
      total_notes,
      myGrooveData.notesPerMeasure
    );
  var Snare =
    '&S=|' +
    tabLineFromAbcNoteArray(
      'S',
      myGrooveData.snare_array,
      true,
      true,
      total_notes,
      myGrooveData.notesPerMeasure
    );
  var Kick =
    '&K=|' +
    tabLineFromAbcNoteArray(
      'K',
      myGrooveData.kick_array,
      true,
      true,
      total_notes,
      myGrooveData.notesPerMeasure
    );

  fullURL += HH + Snare + Kick;

  // only add if we need them.  // they are long and ugly. :)
  if (myGrooveData.showToms) {
    var Tom1 =
      '&T1=|' +
      tabLineFromAbcNoteArray(
        'T1',
        myGrooveData.toms_array[0],
        true,
        true,
        total_notes,
        myGrooveData.notesPerMeasure
      );
    var Tom4 =
      '&T4=|' +
      tabLineFromAbcNoteArray(
        'T4',
        myGrooveData.toms_array[3],
        true,
        true,
        total_notes,
        myGrooveData.notesPerMeasure
      );
    // T2 and T3 have no grid rows. They are written only when they hold notes, and in lane order.
    fullURL +=
      Tom1 +
      tomLaneIfUsed('T2', myGrooveData.toms_array[1]) +
      tomLaneIfUsed('T3', myGrooveData.toms_array[2]) +
      Tom4;
  }

  // only add if we need them.  // they are long and ugly. :)
  if (myGrooveData.showStickings) {
    var Stickings =
      '&Stickings=|' +
      tabLineFromAbcNoteArray(
        'stickings',
        myGrooveData.sticking_array,
        true,
        true,
        total_notes,
        myGrooveData.notesPerMeasure
      );
    fullURL += Stickings;
  }

  return fullURL;
}
