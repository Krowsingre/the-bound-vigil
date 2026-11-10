const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

async function main() {
  const browser = await chromium.launch({channel:"chrome",headless:true});
  try {
    const context = await browser.newContext({ viewport:{width:1440,height:960},permissions:["clipboard-read","clipboard-write"] });
    await context.addInitScript(() => {
      const tabs = Array.from({length:100}, (_,i) => ({id:"t"+(i+1),url:"https://example.com/page-"+(i+1),title:"Fixture tab "+(i+1),pinned:i<2}));
      localStorage.setItem("tbv.browser.tabs",JSON.stringify({tabs,active:"t1"}));
      localStorage.setItem("tbv.libraryView",JSON.stringify({seriesGrouping:"mixed"}));
    });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:2452/",{waitUntil:"commit"});
    page.setDefaultTimeout(25000);
    const sidebar = (name) => page.getByRole("navigation",{name:"Main"}).getByRole("button",{name:new RegExp("^"+name)});
    await page.getByRole("button",{name:/continue reading/i}).first().waitFor();
    await page.evaluate(async () => {
      const {api} = await import("/src/api/index.ts");
      const original = api.getHome.bind(api);
      api.getHome = async () => {
        const data = await original();
        const cover = data.recentlyAdded[0] ?? data.resumeBook;
        return { ...data, recentlyAdded:[
          {...cover,id:"r2",title:"Fixture volume two",series:"Sherlock Holmes",seriesIndex:2},
          {...cover,id:"r1",title:"Fixture volume one",series:" sherlock holmes ",seriesIndex:1},
          {...cover,id:"r3",title:"Standalone fixture",series:null,seriesIndex:null},
        ] };
      };
      api.bookmarks = async () => [{id:"test",title:"Bookmark fixture",url:"https://example.com/bookmark",folderId:null,position:0}];
    });
    await sidebar("Archive").click();
    await sidebar("Sanctum").click();
    const recent = page.locator(".recent");
    const series = recent.getByRole("button",{name:"Open series Sherlock Holmes"});
    await series.waitFor();
    assert.equal(await recent.locator(".shelf > li").count(),2);
    assert.equal(await series.locator(".cover-series-count").textContent(),"2");
    await series.click();
    await page.locator(".library-head").getByText("Sherlock Holmes",{exact:true}).first().waitFor();
    await sidebar("Resonance").click();
    await sidebar("Archive").click();
    await page.locator(".library-head").getByText("Sherlock Holmes",{exact:true}).first().waitFor();
    await sidebar("Archive").click();
    const archive = page.getByRole("button",{name:"Open series Sherlock Holmes",exact:true}).first();
    await archive.waitFor();
    assert(Number(await archive.locator(".cover-series-count").textContent()) >= 2);
    console.log("PASS recent grouping and cover badge; Archive badge, resume on switch and reset on active click");

    await sidebar("Discover").click();
    const tabList = page.getByRole("tablist",{name:"Tabs",exact:true});
    await tabList.getByRole("tab").last().waitFor({state:"attached"});
    assert.equal(await tabList.getByRole("tab").count(),100);
    await page.getByRole("button",{name:"Every tab",exact:true}).click();
    const popup = page.getByRole("menu",{name:"Every tab",exact:true});
    await popup.getByRole("menuitemcheckbox",{name:/^Fixture tab 100/}).click();
    const strip = await tabList.boundingBox();
    const selected = tabList.getByRole("tab",{selected:true});
    const selectedBox = await selected.boundingBox();
    assert(selectedBox.x >= strip.x && selectedBox.x+selectedBox.width <= strip.x+strip.width+1);
    assert.equal(await selected.textContent(),"Fixture tab 100");
    assert.equal(await tabList.getByRole("tab").nth(99).textContent(),"Fixture tab 100");
    const frameBefore = await page.locator(".browser-view").boundingBox();
    if (!(await popup.isVisible())) await page.getByRole("button",{name:"Every tab",exact:true}).click();
    await popup.getByRole("menuitem",{name:"Close Fixture tab 99",exact:true}).click();
    await popup.waitFor();
    assert.equal(await selected.textContent(),"Fixture tab 100");
    assert.equal(await tabList.getByRole("tab").count(),99);
    await page.keyboard.press("Escape");
    await page.getByRole("button",{name:"Undo",exact:true}).click();
    assert.equal(await tabList.getByRole("tab").count(),100);
    assert.equal((await page.locator(".browser-view").boundingBox()).y,frameBefore.y);
    console.log("PASS 100th tab visible without reordering; close in Every tab and undo without vertical movement");

    const field=page.locator("#global-search");
    await field.fill("example");
    const first=page.getByRole("option").first();
    await first.waitFor();
    assert.match(await first.innerText(),/Bookmark fixture.*Open in new tab/s);
    await first.click();
    assert.equal(await tabList.getByRole("tab").count(),101);
    await field.fill("unfinished draft");
    await field.blur();
    await field.focus();
    assert.equal(await field.inputValue(),"unfinished draft");
    assert.notEqual(await field.getAttribute("placeholder"),"Press Enter to paste and go");
    await field.evaluate(input=>input.setSelectionRange(3,3));
    await page.keyboard.press("Backspace");
    assert.equal(await field.inputValue(),"uninished draft");
    await page.keyboard.press("Control+t");
    assert.equal(await field.inputValue(),"");
    await page.evaluate(()=>navigator.clipboard.writeText("https://example.com/pasted"));
    await field.blur();
    await field.focus();
    await page.waitForFunction(()=>document.querySelector("#global-search").placeholder==="Press Enter to paste and go");
    assert.equal(await field.inputValue(),"");
    await page.keyboard.type("real text");
    assert.equal(await field.inputValue(),"real text");
    assert.notEqual(await field.getAttribute("placeholder"),"Press Enter to paste and go");
    console.log("PASS bookmark opens a new tab; draft, caret edits and empty-field paste hint remain separate");
  } finally { await browser.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
