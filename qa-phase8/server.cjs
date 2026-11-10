const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const log = path.join(__dirname, "result", "http.log");
function record(line){fs.appendFileSync(log, line+"\n");}
const server = http.createServer((req,res)=>{
  record(req.method+" "+req.url);
  if(req.url!=="/slow.epub"){res.end("Fixture");return;}
  const block=Buffer.alloc(32768,97);
  res.writeHead(200,{"content-type":"application/epub+zip","content-disposition":"attachment; filename=phase8-slow.epub","content-length":block.length*600});
  res.write(block);
  let sent=1;
  const timer=setInterval(()=>{res.write(block);if(++sent===600){clearInterval(timer);res.end();}},300);
  res.on("close",()=>{clearInterval(timer);record("slow connection closed after "+sent+" blocks");});
});
server.listen(19421,"127.0.0.1",()=>record("ready"));
