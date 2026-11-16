import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,pbkdf2,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {readFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {validatePlayer,nameKey} from './lib/domain.mjs';

const directory=dirname(fileURLToPath(import.meta.url));
const derive=promisify(pbkdf2);
const seed=JSON.parse(readFileSync(join(directory,'lib/seed.json'),'utf8'));
const digest=value=>createHash('sha256').update(value).digest('hex');
const random=()=>randomBytes(32).toString('hex');
async function hashPassword(password){const salt=random();return salt+':'+(await derive(password,salt,210000,32,'sha256')).toString('hex');}
async function checkPassword(password,saved){if(typeof password!=='string'||password.length>200)return false;const [salt,hash]=saved.split(':');const actual=await derive(password,salt,210000,32,'sha256');return timingSafeEqual(actual,Buffer.from(hash,'hex'));}
const error=(status,message)=>Object.assign(new Error(message),{status});

export function createApplication({database,initialPassword,origin}={}){
 const dbPath=database??process.env.FFL_DATABASE??'/var/lib/ffl/league.sqlite';
 const publicOrigin=origin??process.env.FFL_PUBLIC_ORIGIN??'http://127.0.0.1:4010';
 const publicDirectory=process.env.FFL_PUBLIC_DIRECTORY??join(directory,'../../../ffl');
 if(!/^https?:\/\/[^/]+$/.test(publicOrigin))throw new Error('FFL_PUBLIC_ORIGIN must be the exact origin, without a trailing slash.');
 if(dbPath!==':memory:')mkdirSync(dirname(dbPath),{recursive:true,mode:0o700});
 const db=new DatabaseSync(dbPath);db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 db.exec(`CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,saturday REAL NOT NULL CHECK(saturday BETWEEN 0 AND 100),sunday REAL NOT NULL CHECK(sunday BETWEEN 0 AND 100),status TEXT NOT NULL,captain TEXT NOT NULL,co_captain TEXT NOT NULL,notes TEXT NOT NULL,created_at INTEGER NOT NULL,team_id TEXT);
 CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);`);
 const setting=key=>db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
 function transaction(work){db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 function initialize(){transaction(()=>{
  if(!setting('roster_imported')){
   const insert=db.prepare('INSERT OR IGNORE INTO players (id,name,name_key,saturday,sunday,status,captain,co_captain,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
   for(const p of seed)insert.run(p.id,p.name,nameKey(p.name),p.saturday,p.sunday,p.status,p.captain,p.coCaptain,p.notes,Date.now());
   db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('roster_imported','yes');
  }
  if(!setting('teams_imported')){
   for(let i=1;i<=6;i++)db.prepare('INSERT OR IGNORE INTO teams(id,name,name_key,created_at) VALUES (?,?,?,?)').run('team-'+i,'Team '+i,'team '+i,i);
   db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('teams_imported','yes');
  }
 });}
 initialize();
 const ready=(async()=>{
  if(!setting('password')){
   const password=initialPassword??process.env.FFL_INITIAL_PASSWORD;
   if(typeof password!=='string'||password.length<6||password.length>100)throw new Error('Set FFL_INITIAL_PASSWORD to a unique password (6–100 characters) before first start.');
   db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').run('password',await hashPassword(password));
  }
 })();
 // Observe startup failures immediately, while also propagating them to callers.
 ready.catch(()=>{});
 const getToken=req=>req.headers.cookie?.match(/(?:^|;\s*)ffl_admin=([a-f0-9]{64})(?:;|$)/)?.[1];
 const admin=req=>{const token=getToken(req);return !!token&&!!db.prepare('SELECT token FROM sessions WHERE token=? AND expires>?').get(digest(token),Date.now());};
 const cookie=value=>`ffl_admin=${value}; HttpOnly; SameSite=Strict; Path=/ffl/; Max-Age=${value?43200:0}${publicOrigin.startsWith('https:')?'; Secure':''}`;
 function limit(req,scope,max,window){
  const now=Date.now();db.prepare('DELETE FROM limits WHERE expires<?').run(now);
  // This server binds only to loopback. Nginx overwrites X-Real-IP at the public boundary.
  const ip=String(req.headers['x-real-ip']??req.socket.remoteAddress??'local');const key=scope+':'+digest(ip);
  db.prepare('INSERT INTO limits(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+window);
  if(db.prepare('SELECT count FROM limits WHERE key=?').get(key).count>max)throw error(429,scope==='login'?'Too many login attempts. Try again in 15 minutes.':'Submission limit reached. Please try again in an hour.');
 }
 async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>12000)throw error(413,'Submission is too large.');}try{return JSON.parse(text);}catch{throw error(400,'Invalid submission.');}}
 const reply=(res,value,status=200,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(value));};
 const server=http.createServer(async(req,res)=>{
  try{
   const path=new URL(req.url,'http://localhost').pathname;
   if(path==='/ffl'){res.writeHead(308,{Location:'/ffl/'});res.end();return;}
   if(path!=='/ffl/api/league'){
    const files={'/ffl/':['index.html','text/html; charset=utf-8'],'/ffl/index.html':['index.html','text/html; charset=utf-8'],'/ffl/app.js':['app.js','text/javascript; charset=utf-8'],'/ffl/styles.css':['styles.css','text/css; charset=utf-8'],'/ffl/favicon.svg':['favicon.svg','image/svg+xml']};
    const file=files[path];if(!file||!['GET','HEAD'].includes(req.method))throw error(404,'Page not found.');
    res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",'Referrer-Policy':'same-origin'});res.end(req.method==='HEAD'?undefined:readFileSync(join(publicDirectory,file[0])));return;
   }
   await ready;
   if(req.method==='GET'){
    reply(res,{players:db.prepare('SELECT id,name,saturday,sunday,status,captain,co_captain AS coCaptain,notes,team_id AS teamId,created_at AS createdAt FROM players ORDER BY name_key').all(),teams:db.prepare('SELECT id,name FROM teams ORDER BY created_at,name').all(),admin:admin(req)});return;
   }
   if(req.method!=='POST')throw error(405,'Method not allowed.');
   if(req.headers.origin!==publicOrigin)throw error(403,'Please submit from the FFL website.');
   if(!String(req.headers['content-type']).startsWith('application/json'))throw error(415,'Use a JSON submission.');
   const b=await body(req);if(!b||typeof b!=='object')throw error(400,'Invalid submission.');const action=b.action;
   if(action==='login'){
    limit(req,'login',8,15*60000);
    const passwordVersion=setting('password');
    if(!await checkPassword(b.password,passwordVersion)||setting('password')!==passwordVersion)throw error(401,'Incorrect password. Please try again.');
    const token=random();db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO sessions(token,expires) VALUES (?,?)').run(digest(token),Date.now()+12*3600000);
    reply(res,{ok:true},200,{'Set-Cookie':cookie(token)});return;
   }
   if(action==='logout'){
    const token=getToken(req);if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));reply(res,{ok:true},200,{'Set-Cookie':cookie('')});return;
   }
   const authenticated=admin(req);
   if(action!=='add'&&!authenticated)throw error(401,'Admin login is required to change saved entries.');
   if(action==='password'){
    const passwordVersion=setting('password');
    if(!await checkPassword(b.currentPassword,passwordVersion))throw error(400,'Current password is incorrect.');
    if(typeof b.newPassword!=='string'||b.newPassword.length<6||b.newPassword.length>100)throw error(400,'Use a password between 6 and 100 characters.');
    const hash=await hashPassword(b.newPassword);transaction(()=>{if(setting('password')!==passwordVersion||!admin(req))throw error(401,'Your admin session changed. Please log in again.');db.prepare('UPDATE settings SET value=? WHERE key=?').run(hash,'password');db.prepare('DELETE FROM sessions').run();});reply(res,{ok:true},200,{'Set-Cookie':cookie('')});return;
   }
   if(action==='teamAdd'){
    const name=String(b.name??'').trim();if(!name||name.length>50)throw error(400,'Use a team name between 1 and 50 characters.');
    if(db.prepare('SELECT id FROM teams WHERE name_key=?').get(nameKey(name)))throw error(409,'That team already exists.');
    db.prepare('INSERT INTO teams(id,name,name_key,created_at) VALUES (?,?,?,?)').run(random(),name,nameKey(name),Date.now());
   }else if(action==='assign'){
    if(b.teamId!==null&&!db.prepare('SELECT id FROM teams WHERE id=?').get(String(b.teamId)))throw error(400,'That team no longer exists.');
    if(!db.prepare('UPDATE players SET team_id=? WHERE id=?').run(b.teamId===null?null:String(b.teamId),String(b.id)).changes)throw error(404,'Player no longer exists. Refresh the roster.');
   }else if(action==='delete'){
    if(!db.prepare('DELETE FROM players WHERE id=?').run(String(b.id)).changes)throw error(404,'Player no longer exists. Refresh the roster.');
   }else if(['add','edit'].includes(action)){
    if(action==='add'&&!authenticated)limit(req,'submission',20,3600000);
    let p;try{p=validatePlayer(b.player??{});}catch(e){throw error(400,e.message);}
    const existing=db.prepare('SELECT id FROM players WHERE name_key=?').get(p.nameKey);
    if(existing&&(action==='add'||existing.id!==b.id))throw error(409,'That player is already on the roster. Ask an admin for changes.');
    const values=[p.name,p.nameKey,p.saturday,p.sunday,p.status,p.captain,p.coCaptain,p.notes];
    if(action==='add')db.prepare('INSERT INTO players(name,name_key,saturday,sunday,status,captain,co_captain,notes,id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(...values,random(),Date.now());
    else if(!db.prepare('UPDATE players SET name=?,name_key=?,saturday=?,sunday=?,status=?,captain=?,co_captain=?,notes=? WHERE id=?').run(...values,String(b.id)).changes)throw error(404,'Player no longer exists. Refresh the roster.');
   }else throw error(400,'Unknown action.');
   reply(res,{ok:true});
  }catch(e){const status=e.status??(String(e).includes('UNIQUE constraint')?409:500);if(status===500)console.error(e);if(!res.headersSent)reply(res,{error:status===500?'Could not save your changes. Please try again.':status===409?'That name already exists.':e.message},status);else res.end();}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 return {server,db,initialize,ready};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const app=createApplication();
 await app.ready;
 app.server.listen(Number(process.env.PORT??4010),'127.0.0.1',()=>console.log('FFL ready on http://127.0.0.1:'+(process.env.PORT??4010)+'/ffl/'));
 const stop=()=>app.server.close(()=>{app.db.close();process.exit(0);});process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
