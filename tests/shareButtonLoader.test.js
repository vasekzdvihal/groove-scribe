import { describe, it, expect, beforeEach } from 'vitest';
import { loadShareButton } from '../js/shareButtonLoader.js';

// jsdom loads no scripts or stylesheets, so each test fires the load and error events itself.

describe('loadShareButton', () => {
  let doc;
  const script = () => doc.head.querySelectorAll('script[src="js/share-button.min.js"]');
  const link = () => doc.head.querySelectorAll('link[href="css/share-button.min.css"]');
  const fire = (nodes, type) => nodes.forEach((node) => node.dispatchEvent(new Event(type)));

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('editor');
    doc.head.innerHTML = `
      <link rel="stylesheet" href="css/tokens.css">
      <link rel="stylesheet" href="css/groove_writer_orange.css">`;
  });

  it('adds the script and the stylesheet once and returns the same promise', () => {
    const first = loadShareButton(doc);
    expect(loadShareButton(doc)).toBe(first);
    expect(script()).toHaveLength(1);
    expect(link()).toHaveLength(1);
  });

  it('puts the stylesheet before the editor stylesheet, so the editor rules still win', () => {
    loadShareButton(doc);
    const hrefs = [...doc.head.querySelectorAll('link')].map((node) => node.getAttribute('href'));
    expect(hrefs).toEqual([
      'css/tokens.css',
      'css/share-button.min.css',
      'css/groove_writer_orange.css',
    ]);
  });

  it('resolves when the script and the stylesheet have loaded', async () => {
    let done = false;
    const load = loadShareButton(doc).then(() => (done = true));
    fire(script(), 'load');
    await Promise.resolve();
    expect(done).toBe(false);
    fire(link(), 'load');
    await load;
    expect(done).toBe(true);
  });

  it('rejects when a file does not load, and the next call tries again', async () => {
    const first = loadShareButton(doc);
    fire(script(), 'error');
    await expect(first).rejects.toThrow(/share-button\.min\.js/);
    expect(script()).toHaveLength(0);
    expect(link()).toHaveLength(0);

    const second = loadShareButton(doc);
    expect(second).not.toBe(first);
    expect(script()).toHaveLength(1);
    fire(script(), 'load');
    fire(link(), 'load');
    await expect(second).resolves.toBeUndefined();
  });
});
