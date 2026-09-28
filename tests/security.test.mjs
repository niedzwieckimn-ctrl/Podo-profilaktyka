import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handler} from '../netlify/functions/podo-api.js';
import {validateOrigin} from '../netlify/lib/backend.js';
import {shell,dashboard,patients,patient,calendar,services,finance,ideas,advisor,settings} from '../assets/ui.js';
import {seed} from '../assets/demo.js';
import {dayKey} from '../assets/domain.js';
test('wszystkie widoki renderują się bez brakujących symboli',()=>{
 const s=seed();for(const fn of [()=>shell('dashboard',true,s.settings),()=>dashboard(s),()=>patients(s),()=>patient(s,'p1'),()=>patient(s,'p1','history'),()=>patient(s,'p1','profile'),()=>patient(s,'p1','photos'),()=>calendar(s,dayKey(),dayKey().slice(0,7)),()=>services(s),()=>finance(s),()=>ideas(s),()=>advisor(s,[],'',true,null),()=>settings(s,true)])assert(fn().length>50);
});
test('każda prywatna ścieżka API wymaga JWT, także zdjęcia i AI',async()=>{
 const previous=global.fetch;let called=false;global.fetch=()=>{called=true;throw Error('Nie wolno wywołać bazy bez JWT');};
 try{for(const action of ['book','patient','encounter','advisor','photo','photo-url','idea']){const r=await handler({httpMethod:'POST',headers:{},body:JSON.stringify({action,data:{}})});assert.equal(r.statusCode,401,action);}const r=await handler({httpMethod:'GET',headers:{}});assert.equal(r.statusCode,401);assert.equal(called,false);}finally{global.fetch=previous;}
});
test('publiczna konfiguracja nie ujawnia klucza serwerowego',async()=>{
 const previous=process.env.SUPABASE_SERVICE_ROLE_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY='PRIVATE-SERVICE-KEY';
 try{const r=await handler({httpMethod:'GET',headers:{},queryStringParameters:{config:'1'}});assert.equal(r.statusCode,200);assert(!r.body.includes('PRIVATE-SERVICE-KEY'));}finally{if(previous===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=previous;}
});
test('obce źródło POST jest blokowane',()=>{assert.throws(()=>validateOrigin({headers:{origin:'https://evil.invalid',host:'podocare.netlify.app'}}),/Niedozwolone/);assert.doesNotThrow(()=>validateOrigin({headers:{origin:'https://podocare.netlify.app',host:'podocare.netlify.app'}}));});
test('tekst pacjenta jest escapowany w HTML',()=>{const s=seed();s.patients[0].name='<img src=x onerror=alert(1)>';const html=patient(s,'p1');assert(!html.includes('<img src=x'));assert(html.includes('&lt;img'));});
test('PWA nie cacheuje odpowiedzi API ani danych pacjentów',async()=>{const sw=await readFile(new URL('../service-worker.js',import.meta.url),'utf8');assert(!sw.includes('caches.open'));assert(!sw.includes('cache.put'));const app=await readFile(new URL('../assets/app.js',import.meta.url),'utf8');assert(!app.includes('localStorage.'));assert(!app.includes('sessionStorage.'));});
