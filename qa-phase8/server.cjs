const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const log = path.join(__dirname, "result", "http.log");
function record(line){fs.appendFileSync(log, line+"\n");}
const server = http.createServer((req,res)=>{
  record(req.method+" "+req.url);
  if(req.url==="/popup"){
    res.setHeader("content-type","text/html; charset=utf-8");
    res.end('<title>Popup fixture</title><button onclick="window.open(\'/slow.epub\',\'fixture\',\'width=560,height=400\')">Download now</button>');
    return;
  }
  if(req.url==="/redirect"){res.writeHead(302,{location:"/landed"});res.end();return;}
  if(req.url==="/landed"){res.setHeader("content-type","text/html");res.end("<title>Redirect fixture</title><h1>Redirect reached</h1>");return;}
  if(req.url!=="/slow.epub"){res.end("Fixture");return;}
  const block=Buffer.alloc(32768,97);
  res.writeHead(200,{"content-type":"application/epub+zip","content-disposition":"attachment; filename=phase8-slow.epub","content-length":block.length*600});
  res.write(block);
  let sent=1;
  const timer=setInterval(()=>{res.write(block);if(++sent===600){clearInterval(timer);res.end();}},300);
  res.on("close",()=>{clearInterval(timer);record("slow connection closed after "+sent+" blocks");});
});
server.listen(19421,"127.0.0.1",()=>record("ready"));
