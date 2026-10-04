'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const allowed={'/':'index.html','/index.html':'index.html','/engine.js':'engine.js','/app.js':'app.js','/style.css':'style.css'};
const server=http.createServer((req,res)=>{const file=allowed[new URL(req.url,'http://localhost').pathname];if(!file){res.writeHead(404);return res.end('Not found');}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');fs.createReadStream(path.join(__dirname,file)).pipe(res);});
server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('ALLUR demo: http://127.0.0.1:'+server.address().port));
