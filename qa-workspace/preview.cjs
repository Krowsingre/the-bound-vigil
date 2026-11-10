const { chromium } = require("playwright");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mobile of [false, true]) {
      const page = await browser.newPage(mobile ? { viewport: {width: 430, height: 932}, hasTouch: true, isMobile: true } : { viewport: {width: 1536, height: 1024} });
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      page.setDefaultTimeout(120000); await page.goto("http://127.0.0.1:2452/", { waitUntil: "commit", timeout: 120000 });
      await page.getByRole("button", {name: /continue reading/i}).first().waitFor();
      if (mobile) await page.locator(".header button").filter({has: page.locator("svg")}).count();
      const nav = page.getByRole("navigation", {name:"Main"});
      const menu = page.getByRole("button", {name: /^(open menu|menu|open the menu)$/i}).first();
      if (mobile) await menu.click();
      const sanctum = nav.getByRole("button", {name:/^Sanctum/i});
      await sanctum.click({button:"right"});
      await page.getByRole("menuitem", {name:"Split screen", exact:true}).click();
      const secondary = page.frameLocator('iframe[title="Secondary TBV pane"]');
      await secondary.getByRole("button", {name:/continue reading/i}).first().waitFor();
      assert.equal(await page.getByRole("separator", {name:"Resize TBV panes"}).getAttribute("aria-orientation"), mobile ? "horizontal" : "vertical");
      if (mobile && await page.getByRole("button", {name:"Close the menu"}).isVisible()) await page.getByRole("button", {name:"Close the menu"}).click();
      const secondMenu = secondary.getByRole("button",{name:"Menu",exact:true});
      const secondaryNav = secondary.getByRole("navigation",{name:"Main"});
      if (await secondMenu.isVisible()) await secondMenu.click();
      await secondaryNav.getByRole("button",{name:/^Archive/i}).click();
      const other = secondary.locator('.grid-open[title^="Middlemarch"], .book-row button[title^="Middlemarch"]').first();
      await other.click();
      const detailsRead=secondary.getByRole("button",{name:/^(Read|Continue reading)$/}).first();
      if (await detailsRead.isVisible()) await detailsRead.click();
      await secondary.locator('.reader-host[aria-busy="false"]').waitFor();
      await page.getByRole("button", {name:/continue reading/i}).first().click();
      await page.locator('.reader-host[aria-busy="false"]').waitFor();
      const title = await page.locator(".reader-top-title strong").textContent();
      const otherTitle = await secondary.locator(".reader-top-title strong").textContent();
      assert.notEqual(title, otherTitle);
      assert.equal(otherTitle, "Middlemarch");
      const chapter=await page.locator(".reader-bottom-chapter").textContent();
      await secondary.getByRole("button",{name:"Next page",exact:true}).click();
      assert.equal(await page.locator(".reader-bottom-chapter").textContent(),chapter);
      assert.equal(await page.locator(".reader").count(),1);
      assert.equal(await secondary.locator(".reader").count(),1);
      await page.getByRole("button", {name:"Close split", exact:true}).click();
      await page.locator('iframe[title="Secondary TBV pane"]').waitFor({state:"detached"});
      await page.locator('.reader-host[aria-busy="false"]').waitFor();
      assert.deepEqual(errors,[]);
      console.log(mobile?"phone":"desktop", "Sanctum split, concurrent Readers, close keeps primary");
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
