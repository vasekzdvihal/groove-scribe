// "Back to the editor" on the Help and About pages. The editor opens these pages in the same
// tab, and its address holds the groove. So when the editor is the page before this one, the
// link goes back in the history and the groove returns as it was. After a step from Help to
// About, the link opens the editor address that this tab came from. A page reached in another
// way, such as a bookmark, has no editor behind it, and the link opens index.html.

const KEY = 'grooveScribe.editorAddress';

/**
 * @param {string} referrer
 * @param {Location} here
 * @returns {boolean} true when the page before this one is the editor of this site
 */
function cameFromEditor(referrer, here) {
  try {
    const from = new URL(referrer);
    return from.origin === here.origin && /\/(index\.html)?$/.test(from.pathname);
  } catch {
    return false;
  }
}

// Storage can be blocked, for example in a private window. Then the link opens index.html.
function remember(address) {
  try {
    sessionStorage.setItem(KEY, address);
  } catch {
    /* the plain link still works */
  }
}

function remembered() {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const fromEditor = cameFromEditor(document.referrer, window.location);
if (fromEditor) remember(document.referrer);

for (const link of document.querySelectorAll('a.back')) {
  link.addEventListener('click', (event) => {
    if (fromEditor && window.history.length > 1) {
      event.preventDefault();
      window.history.back();
      return;
    }
    const address = remembered();
    if (address && cameFromEditor(address, window.location)) {
      event.preventDefault();
      window.location.href = address;
    }
  });
}
