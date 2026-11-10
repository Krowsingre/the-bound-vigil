const http = require("node:http");
http.createServer((req, res) => {
  const pages = {
    "/left": '<title>Left fixture</title><h1>Left fixture</h1><a href="/target">Open the fixture link</a>',
    "/right": '<title>Right fixture</title><h1>Right fixture</h1>',
    "/target": '<title>Link target fixture</title><h1>Link target fixture</h1>',
  };
  res.writeHead(200, {"content-type": "text/html; charset=utf-8"});
  res.end(pages[req.url] || "<h1>Local fixture</h1>");
}).listen(19421, "127.0.0.1");
