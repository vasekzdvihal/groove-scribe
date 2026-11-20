import AxeBuilder from '@axe-core/playwright';

// Helpers for the accessibility tests. Playwright cannot import one spec file from another,
// so later specs import from here.

// The text in a sticking cell (R, L, R/L, a count) is the value of the cell, not its label.
// axe counts all four stacked glyphs as visible text, also the transparent ones, so no state
// name can contain it. axe treats a checkbox or a switch the same way ("needs review"), but it
// does not know that a grid cell can hold a value. So this one rule skips the sticking cells.
function isValueTextCell(node) {
  return /^<[a-z]+\b[^>]*\brole="gridcell"[^>]*\bdata-instrument="sticking"/.test(node.html);
}

function withoutValueTextCells(violations) {
  return violations
    .map((v) =>
      v.id === 'label-content-name-mismatch'
        ? { ...v, nodes: v.nodes.filter((node) => !isValueTextCell(node)) }
        : v
    )
    .filter((v) => v.nodes.length > 0);
}

// Runs axe with the WCAG A and AA rules and the best-practice rules. Returns the violations.
// The sheet music SVG is not scanned: abc2svg draws it, and the golden master pins its output.
export async function axeScan(page, { include, disableRules = [] } = {}) {
  let builder = new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .exclude('#svgTarget svg')
    .disableRules(disableRules);
  if (include) builder = builder.include(include);
  return withoutValueTextCells((await builder.analyze()).violations);
}

// "<rule id>: <first target>" for each violation that is serious or critical.
export function seriousOrWorse(violations) {
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes[0].target.join(' ')}`);
}

function luminance(rgb) {
  const [r, g, b] = rgb
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number)
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The WCAG contrast ratio of two 'rgb(r, g, b)' strings.
export function contrastRatio(rgbA, rgbB) {
  const [a, b] = [luminance(rgbA), luminance(rgbB)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
