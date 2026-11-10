const assert=require("node:assert/strict");
const {chromium}=require("playwright-core");
(async()=>{
  const browser=await chromium.launch({channel:"chrome",headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    page.setDefaultTimeout(20000);
    await page.addInitScript(()=>{
      localStorage.setItem("tbv.libraryView",JSON.stringify({seriesGrouping:"mixed"}));
      localStorage.setItem("tbv.compendium.smartFolded","0");
    });
    await page.goto("http://127.0.0.1:2452/",{waitUntil:"commit"});
    await page.getByRole("button",{name:/continue reading/i}).first().waitFor();
    const nav=(where,name)=>where.getByRole("navigation",{name:"Main"}).getByRole("button",{name:new RegExp("^"+name)});
    await page.evaluate(async()=>{
      const {api}=await import("/src/api/index.ts");
      api.allTags=async()=>[{name:"Fantasy",count:3},{name:"Urban Fantasy",count:1}];
      const original=api.bookDetails.bind(api);
      api.bookDetails=async id=>{const data=await original(id);return {...data,book:{...data.book,inCloud:true,availability:"local"}};};
      api.removeDownload=async id=>{window.removed=id;};
    });
    await nav(page,"Compendium").click();
    await page.getByRole("button",{name:/^Read(?:\s|$)/}).first().click();
    const readSwitch=page.getByRole("group",{name:"Which books"});
    await readSwitch.getByRole("button",{name:"Read",exact:true}).waitFor();
    assert.equal(await readSwitch.getByRole("button",{name:"All",exact:true}).count(),0);
    await readSwitch.getByRole("button",{name:"Dropped",exact:true}).click();
    console.log("PASS Read compendium only offers Read and Dropped");
    await nav(page,"Archive").click();
    await page.getByRole("button",{name:"Open series Sherlock Holmes",exact:true}).first().click();
    await page.getByRole("button",{name:"Back to Archive",exact:true}).waitFor();
    await page.locator(".grid-open[title^='The Sign of the Four']").first().click();
    await page.getByRole("button",{name:"Back",exact:true}).waitFor();
    await page.getByRole("button",{name:/^(Edit|Add) tags$/}).click();
    const tag=page.getByRole("textbox",{name:"New tag"});
    await page.keyboard.type("fant");
    await page.getByRole("button",{name:"Fantasy",exact:true}).waitFor();
    assert.equal(await tag.inputValue(),"fant");
    await tag.evaluate(el=>el.setSelectionRange(2,2));
    await page.keyboard.press("Backspace");
    assert.equal(await tag.inputValue(),"fnt");
    await tag.fill("fant");
    await page.getByRole("button",{name:"Fantasy",exact:true}).click();
    assert.equal(await tag.inputValue(),"");
    await page.getByRole("button",{name:"Cancel",exact:true}).click();
    await page.getByRole("button",{name:/^More for The Sign of the Four/}).click();
    const status=page.getByRole("menuitem",{name:/reading status/i});
    if(await status.isVisible())await status.click();
    await page.getByRole("menuitem",{name:/Mark as dropped/}).click();
    const removal=page.getByRole("alertdialog",{name:/Remove .* from this device/});
    await removal.waitFor();
    assert.equal(await page.evaluate(()=>window.removed),undefined);
    await removal.getByRole("button",{name:"Keep on device"}).click();
    assert.equal(await page.evaluate(()=>window.removed),undefined);
    await page.getByRole("button",{name:"Back",exact:true}).click();
    await page.getByRole("button",{name:"Back to Archive",exact:true}).click();
    await page.getByRole("button",{name:"Open series Sherlock Holmes",exact:true}).first().waitFor();
    console.log("PASS matching tag options preserve typing; dropped prompts without deleting; Details and series Back reach Archive");

    await nav(page,"Sanctum").click();
    await nav(page,"Sanctum").click({button:"right"});
    await page.getByRole("menuitem",{name:"Split screen",exact:true}).click();
    const other=page.frameLocator('iframe[title="Secondary TBV pane"]');
    for(const where of [page,other]){
      const rail=where.locator(".sidebar.is-collapsed");
      await rail.waitFor({state:"visible"});
      assert.equal(await rail.getByRole("button",{name:"Expand menu"}).count(),0);
      await where.getByRole("button",{name:/continue reading/i}).first().click();
      await where.locator('.reader-host[aria-busy="false"]').waitFor();
      await rail.waitFor({state:"visible"});
    }
    console.log("PASS both panes keep a locked collapsed rail on Sanctum and inside the Reader");
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
