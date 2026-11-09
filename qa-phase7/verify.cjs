const { chromium } = require('playwright-core');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = __dirname;
const out = path.join(root, 'result');
fs.mkdirSync(out, { recursive: true });
const child = spawn(process.env.TBV_TEST_EXE, [], {
  env: {...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=19357 --remote-allow-origins=* --enable-logging=stderr', WEBVIEW2_USER_DATA_FOLDER: path.join(process.env.RUNNER_TEMP,'tbv-test-webview')},
  stdio: ['ignore', 'inherit', 'inherit'],
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let page;
(async () => {
  let browser;
  let lastError;
  for (let i=0;i<60;i++) {
    try {
      const response=await fetch('http://127.0.0.1:19357/json/version');
      if (response.ok) {
        console.log('WebView2 debug endpoint responded'); browser=await chromium.connectOverCDP('http://127.0.0.1:19357',{timeout:5000});
        break;
      }
    } catch (error) { lastError=error; }
    if (child.exitCode !== null) throw Error('Installed app exited with '+child.exitCode);
    await wait(1000);
  }
  assert(browser,'WebView2 debugger did not start: '+lastError?.stack+' '+lastError?.cause);
  for (let i=0;i<30 && !page;i++) {
    page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost') && !p.url().includes('splash'));
    if (!page) await wait(500);
  }
  assert(page,'TBV main window did not start');
  page.setDefaultTimeout(20000);
  await page.waitForFunction(()=>!!window.__TAURI_INTERNALS__?.invoke);
  const invoke = (command,args={}) => page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
  const epub=path.join(root,'scribe-figure.epub');
  const mobi=path.join(root,'structured-old.mobi');
  await invoke('queue_imports',{paths:[epub,mobi]});
  let books;
  for(let i=0;i<30;i++){
    books=(await invoke('get_library',{query:{pageSize:25}})).books;
    if(books.some(b=>b.format==='epub') && books.some(b=>b.format==='mobi')) break;
    await wait(500);
  }
  const primary=books.find(b=>b.format==='mobi');
  const selected=books.find(b=>b.format==='epub');
  assert(primary && selected,'Both test formats imported');
  await invoke('keep_together',{mainId:primary.id,otherIds:[selected.id]});
  await invoke('open_book',{bookId:primary.id});
  await invoke('save_position',{bookId:primary.id,locator:{format:'epub',totalProgression:0.1,chapter:'Chapter One'}});
  await page.reload();
  await page.getByRole('button',{name:/continue reading/i}).first().click();
  const expand=page.getByRole('button',{name:'Expand Fixture caption'});
  await page.locator('.reader-host[aria-busy=false]').waitFor();
  for(let i=0;i<8 && !(await expand.count());i++){
    await wait(250);
    if (!(await expand.count())) await page.getByRole('button',{name:'Next page'}).click();
  }
  await expand.click();
  const viewer=page.getByRole('dialog',{name:'Expanded Fixture caption'});
  await viewer.getByRole('img',{name:'Blue chart'}).waitFor();
  await viewer.getByRole('button',{name:'Zoom in'}).click();
  const html=fs.readFileSync(path.join(root,'scribe-figure-print.html'),'utf8');
  const pdf=path.join(out,'native-scribe.pdf');
  assert((await invoke('print_book',{html,path:pdf}))>0);
  const printed=fs.readFileSync(pdf);
  assert(printed.subarray(0,5).equals(Buffer.from('%PDF-')));
  assert(printed.includes(Buffer.from('/Subtype /Image')));
  await viewer.getByRole('button',{name:'Close'}).click();
  await expand.waitFor();
  await page.getByRole('button',{name:'More',exact:true}).click();
  await page.getByRole('menuitem',{name:'Save a copy (EPUB)'}).waitFor();
  const expected=fs.readFileSync(epub);
  const filename='Scribe Fixture - Test.epub';
  const collision=Buffer.from(expected); collision[0]^=1;
  fs.writeFileSync(path.join(out,filename),collision);
  assert.equal(await invoke('save_copies',{bookIds:[selected.id],folder:out}),1);
  assert.deepEqual(fs.readFileSync(path.join(out,'Scribe Fixture - Test (2).epub')),expected);
  assert.deepEqual(fs.readFileSync(path.join(out,filename)),collision);
  await page.screenshot({path:path.join(out,'installed-reader.png')});
  console.log('Installed Windows: Reader expanded the linked EPUB, native Scribe PDF contained an image, selected EPUB export was byte-identical, and destination collision was preserved.');
})().catch(async error=>{
  console.error(error);
  if (!page) {
    const {execFileSync}=require('node:child_process');
    const diagnostic="Get-Process the-bound-vigil,msedgewebview2 -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,SessionId,MainWindowTitle | Format-Table -AutoSize; Get-NetTCPConnection -LocalPort 19357 -ErrorAction SilentlyContinue | Select-Object State,OwningProcess";
    console.error(execFileSync('powershell.exe',['-NoProfile','-Command',diagnostic],{encoding:'utf8'}));
  }
  if(page) {
    console.error((await page.locator('body').innerText({timeout:3000}).catch(()=>'' )).slice(0,1400));
    await page.screenshot({path:path.join(out,'failure.png'),timeout:3000}).catch(()=>{});
  }
  process.exitCode=1;
}).finally(()=>{child.kill();setTimeout(()=>process.exit(process.exitCode ?? 0),1000).unref();});
