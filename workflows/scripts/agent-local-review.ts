/** Synthetic local acceptance server. Never reads .env or calls external services. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
import {database,syntheticDraft} from '../test/listing-lifecycle-fixture';
import {handleListingRequest} from '../src/listings/api';
const root=fileURLToPath(new URL('../website/',import.meta.url)),repo=await database();
const origin='http://127.0.0.1:4186';
const config={LISTINGS_ENABLED:'true',LISTING_TEST_MODE:'true',AGENT_LISTINGS_ENABLED:'true',LISTING_PUBLICATION_ENABLED:'true',LISTING_SITE_URL:'https://synthetic.invalid/',WEBSITE_ORIGIN:origin};
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url||'/',origin);
 if(url.pathname.startsWith('/api/')){
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks);
  const response=await handleListingRequest(new Request(url,{method:req.method,headers:req.headers as Record<string,string>,...(body.length?{body}:{} )}),config,repo);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
 }
 if(url.pathname==='/__synthetic/draft'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(syntheticDraft()));return;}
 const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
 if(!file.startsWith(resolve(root)+sep)){res.writeHead(403);res.end();return;}
 const data=await readFile(file);const mime:Record<string,string>={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
 res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
 }catch{res.writeHead(404);res.end('Not found');}});
server.listen(4186,'127.0.0.1',()=>console.log('Synthetic local acceptance server: '+origin));
const close=()=>{server.close();repo.db.close().then(()=>process.exit(0));};process.on('SIGINT',close);process.on('SIGTERM',close);
