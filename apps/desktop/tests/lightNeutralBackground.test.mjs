import assert from "node:assert/strict";
import test from "node:test";
import { readRendererStyles } from "./helpers/rendererStyles.mjs";

const css = readRendererStyles();

function block(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped} \\{([^}]*)\\}`));
  assert.ok(match, `missing ${selector}`);
  return match[1];
}

test("Hydro brand uses rice-white workspace, deep-qing sidebar, and derived surfaces", () => {
  const brand = block(':root[data-appearance="classic-green"]');
  assert.match(brand, /--color-bg-app:\s*var\(--hydro-rice\);/i);
  assert.match(brand, /--color-bg-sidebar:\s*var\(--hydro-qing\);/i);
  assert.match(brand, /--color-bg-panel:\s*#fff;/i);
  assert.match(brand, /--color-bg-muted:\s*color-mix\(/i);
  assert.match(brand, /--color-bg-hover:\s*color-mix\(/i);
  assert.match(brand, /--color-bg-active:\s*color-mix\(/i);
  assert.match(brand, /--color-border-subtle:\s*color-mix\(/i);
  assert.match(brand, /--color-border-default:\s*color-mix\(/i);
  assert.match(brand, /--color-border-strong:\s*color-mix\(/i);
});
