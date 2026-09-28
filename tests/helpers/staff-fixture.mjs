// Wyłącznie lokalny transport testowy. Rzeczywiste RPC i SQL, atrapy Auth/Storage/Resend.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {handler} from '../../netlify/functions/podo-api.js';
export async function staffFixture(){
 const pg=new PGlite(),root=resolve('.'),actor=crypto.randomUUID(),outsider=crypto.randomUUID(),objects=new Map();
 await pg.exec('create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
 for(const name of ['001_podocare.sql','002_patient_photos.sql','003_staff_clinic.sql','004_clinic_setup.sql'])await pg.exec(await readFile(resolve(root,'supabase',name),'utf8'));
 await pg.query('insert into auth.users values($1),($2)',[actor,outsider]);await pg.query('insert into podo_admins values($1)',[actor]);
 const session={access_token:'staff-test-token',refresh_token:'refresh-test-token',expires_in:3600};
 let base;const previousFetch=global.fetch,previousEnv={};
 const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,base);try{
   if(url.pathname==='/auth/v1/token'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(session));return;}
   if(url.pathname==='/.netlify/functions/podo-api'){
    const chunks=[];for await(const c of req)chunks.push(c);
    const result=await handler({httpMethod:req.method,headers:req.headers,queryStringParameters:Object.fromEntries(url.searchParams),body:Buffer.concat(chunks).toString()});res.writeHead(result.statusCode,result.headers);res.end(result.body);return;
   }
   if(url.pathname.startsWith('/storage/v1/object/sign/')){const bytes=objects.get(url.pathname.replace('/storage/v1/object/sign/',''));res.writeHead(bytes?200:404,{'Content-Type':'image/jpeg','Cache-Control':'no-store'});res.end(bytes||'');return;}
   const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!path.startsWith(root+sep))throw Error('Path outside fixture');
   const type={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'}[extname(path)]||'text/plain';
   res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(await readFile(path));
  }catch(e){if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
 for(const [k,v] of Object.entries({SUPABASE_URL:base,SUPABASE_SERVICE_ROLE_KEY:'fixture-server-key',SUPABASE_PUBLISHABLE_KEY:'fixture-public-key',EMAIL_DELIVERY_ENABLED:'false',CONTEXT:'dev'})){previousEnv[k]=process.env[k];process.env[k]=v;}
 global.fetch=async(input,options={})=>{
  const url=new URL(input),path=url.pathname;
  if(url.origin!==base)throw Error('Zewnętrzna sieć zablokowana w teście: '+url.origin);
  const data=options.body&&!Buffer.isBuffer(options.body)?JSON.parse(options.body):null;
  if(path==='/auth/v1/user'){const token=options.headers.Authorization;if(!['Bearer staff-test-token','Bearer outsider-token'].includes(token))return response({},401);return response({id:token.includes('outsider')?outsider:actor,email:'personel@example.invalid'});}
  if(path.startsWith('/rest/v1/rpc/')){
   try{let result;const name=path.split('/').at(-1);
    if(name==='podo_action')result=(await pg.query('select podo_action($1,$2::jsonb,$3) r',[data.p_action,JSON.stringify(data.p_data),data.p_actor])).rows[0].r;
    else if(name==='podo_add_photo')result=(await pg.query('select podo_add_photo($1::jsonb,$2) r',[JSON.stringify(data.p_data),data.p_actor])).rows[0].r;
    else throw Error('RPC not in fixture');return response(result);
   }catch(e){return response({message:e.message},400);}
  }
  if(path.startsWith('/rest/v1/')){
   const table=path.split('/').at(-1);if(!/^podo_[a-z_]+$/.test(table)||options.method&&options.method!=='GET')throw Error('Unexpected fixture read');
   const args=[],conditions=[];for(const [key,value] of url.searchParams){if(['select','limit','offset','order'].includes(key))continue;if(!/^[a-z_]+$/.test(key)||!value.startsWith('eq.'))throw Error('Unexpected filter');args.push(value.slice(3));conditions.push(`${key}=$${args.length}`);}
   const rows=(await pg.query(`select * from ${table}${conditions.length?' where '+conditions.join(' and '):''} order by ${table==='podo_admins'?'user_id':'id'} limit ${Number(url.searchParams.get('limit')||500)} offset ${Number(url.searchParams.get('offset')||0)}`,args)).rows;
   for(const row of rows)for(const key of ['birth_date','followup_date','taken_on'])if(row[key] instanceof Date)row[key]=row[key].toISOString().slice(0,10);
   return response(rows);
  }
  if(path.startsWith('/storage/v1/object/sign/'))return response({signedURL:path.replace('/storage/v1','')+'?token=test-only'});
  if(path.startsWith('/storage/v1/object/authenticated/')){const bytes=objects.get(path.replace('/storage/v1/object/authenticated/',''));return new Response(bytes,{status:bytes?200:404});}
  if(path.startsWith('/storage/v1/object/')){const key=path.replace('/storage/v1/object/','');if(objects.has(key))return response({error:'Duplicate'},409);objects.set(key,options.body);return response({Key:key});}
  throw Error('Unexpected fixture URL: '+path);
 };
 return {pg,base,actor,session,handler,objects,close:async()=>{global.fetch=previousFetch;for(const [k,v] of Object.entries(previousEnv))if(v===undefined)delete process.env[k];else process.env[k]=v;await new Promise(r=>server.close(r));await pg.close();}};
}
