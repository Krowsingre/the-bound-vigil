const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    for (const width of [1536, 1024, 430]) {
      const mobile = width === 430;
      const page = await browser.newPage(mobile ? { viewport: {width: 430, height: 932}, hasTouch: true, isMobile: true } : { viewport: {width, height: 1024} });
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      page.setDefaultTimeout(120000); await page.goto("http://127.0.0.1:2452/", { waitUntil: "commit", timeout: 120000 });
      await page.getByRole("button", {name: /continue reading/i}).first().waitFor();

      const nav = page.getByRole("navigation", {name:"Main"});
      const menu = page.getByRole("button", {name: /^(open menu|menu|open the menu)$/i}).first();
      if (mobile) await menu.click();
      const sanctum = nav.getByRole("button", {name:/^Sanctum/i});
      if (mobile) {
        const touch = await page.context().newCDPSession(page);
        const rect = await sanctum.boundingBox();
        await touch.send("Input.dispatchTouchEvent", {type:"touchStart", touchPoints:[{x:rect.x+rect.width/2,y:rect.y+rect.height/2}]});
        await page.getByRole("menuitem",{name:"Split screen",exact:true}).waitFor();
        await touch.send("Input.dispatchTouchEvent", {type:"touchEnd", touchPoints:[]});
      } else {
        await sanctum.click({button:"right"});
      }
      await page.getByRole("menuitem", {name:"Split screen", exact:true}).click();
      const secondary = page.frameLocator('iframe[title="Secondary TBV pane"]');
      await secondary.getByRole("button", {name:/continue reading/i}).first().waitFor();
      assert.equal(await page.getByRole("separator", {name:"Resize TBV panes"}).getAttribute("aria-orientation"), mobile ? "horizontal" : "vertical");
      await page.locator(".sidebar.is-drawer-open").waitFor({state:"detached"});
      const secondMenu = secondary.getByRole("button",{name:"Menu",exact:true});
      const secondaryNav = secondary.getByRole("navigation",{name:"Main"});
      if (await secondMenu.isVisible()) await secondMenu.click();
      await secondaryNav.getByRole("button",{name:/^Archive/i}).click();
      const firstSearch = page.locator("#global-search");
      const previousSearch = await firstSearch.inputValue();
      await secondary.locator("#global-search").fill("Middlemarch");
      assert.equal(await firstSearch.inputValue(), previousSearch);
      const other = secondary.locator('.grid-open[title^="Middlemarch"], .book-row button[title^="Middlemarch"]').first();
      await other.click();
      const detailsRead=secondary.getByRole("button",{name:/^(Read|Continue reading)$/}).first();
      await detailsRead.click();
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
      if (width === 1024) {
        assert.equal(await page.locator(".reader.is-compact").count(),1);
        const pane = await page.locator(".tbv-workspace-primary").boundingBox();
        const next = await page.getByRole("button", {name:"Next page",exact:true}).boundingBox();
        assert(next.x+next.width <= pane.x+pane.width);
      }
      assert.equal(await secondary.locator(".reader").count(),1);
      await page.getByRole("button", {name:"Close split", exact:true}).click();
      await page.locator('iframe[title="Secondary TBV pane"]').waitFor({state:"detached"});
      await page.locator('.reader-host[aria-busy="false"]').waitFor();
      assert.deepEqual(errors,[]);
      console.log(width, "Sanctum split, concurrent Readers, close keeps primary");
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
