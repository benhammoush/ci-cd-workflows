/** Verify installed native dependencies by rendering one page in each required engine. @file */
import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

for (const engine of [chromium, firefox, webkit]) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<h1>Browser host ready</h1>");
    assert.equal(await page.locator("h1").textContent(), "Browser host ready");
    console.log(`${engine.name()}: native dependency/render smoke passed`);
  } finally {
    await browser.close();
  }
}
