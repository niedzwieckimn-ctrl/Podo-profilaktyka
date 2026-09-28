import test from 'node:test';
import assert from 'node:assert/strict';
import {mailEnabled,flushMail} from '../netlify/lib/mail.js';
const keys={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',RESEND_API_KEY:'fixture',FROM_EMAIL:'Gabinet <test@example.invalid>',REPLY_TO_EMAIL:'kontakt@example.invalid',EMAIL_DELIVERY_ENABLED:'true'};
async function setup(run){const oldEnv={};for(const [k,v] of Object.entries(keys)){oldEnv[k]=process.env[k];process.env[k]=v;}const oldFetch=global.fetch;try{await run();}finally{global.fetch=oldFetch;for(const [k,v] of Object.entries(oldEnv))if(v===undefined)delete process.env[k];else process.env[k]=v;}}
const respond=d=>new Response(JSON.stringify(d),{headers:{'Content-Type':'application/json'}});
test('poczta domyślnie wyłączona, brak wywołań w preview',async()=>setup(async()=>{
 global.fetch=()=>{throw Error('Nie wolno wywołać sieci');};assert.equal(mailEnabled(false),false);await flushMail({production:false});
 process.env.EMAIL_DELIVERY_ENABLED='false';assert.equal(mailEnabled(true),false);assert.deepEqual(await flushMail({production:true}),{configured:false,sent:0});
}));
test('worker używa zapisanego odbiorcy i idempotencji, bez danych zdrowotnych',async()=>setup(async()=>{
 const a={status:'confirmed',starts_at:'2036-09-28T08:00:00Z',ends_at:'2036-09-28T09:00:00Z',patient_email:'opiekun@example.invalid',clinic_name:'Gabinet',clinic_address:'Adres gabinetu',service_name:'PRYWATNY ZABIEG',patient_name:'PRYWATNA OSOBA',note:'TAJNA NOTATKA'};let sent,patch;
 global.fetch=async(url,opt)=>{if(url.includes('/rpc/podo_claim_mail'))return respond([{id:'job',appointment_id:'visit',kind:'confirmed',attempts:1}]);if(url.includes('/podo_appointments?'))return respond([a]);if(opt.method==='PATCH'){patch=JSON.parse(opt.body);return respond(null);}if(url.includes('/podo_mail?'))return respond([{state:'leased'}]);if(url==='https://api.resend.com/emails'){sent={body:JSON.parse(opt.body),headers:opt.headers};return respond({id:'resend-test'});}throw Error('Nieoczekiwany URL');};
 assert.equal((await flushMail({production:true})).sent,1);assert.deepEqual(sent.body.to,['opiekun@example.invalid']);assert.equal(sent.body.reply_to,'kontakt@example.invalid');assert.equal(sent.headers['Idempotency-Key'],'podocare-job');assert.equal(patch.state,'sent');assert(!JSON.stringify(sent.body).includes('PRYWAT'));assert(!JSON.stringify(sent.body).includes('TAJNA'));assert(!('scheduled_at' in sent.body));
}));
test('anulowana wizyta nie otrzymuje przypomnienia nawet po pobraniu zadania',async()=>setup(async()=>{
 let sends=0,patch;
 global.fetch=async(url,opt)=>{if(url.includes('/rpc/'))return respond([{id:'job',appointment_id:'visit',kind:'reminder',attempts:1}]);if(url.includes('/podo_appointments?'))return respond([{status:'cancelled'}]);if(opt.method==='PATCH'){patch=JSON.parse(opt.body);return respond(null);}if(url.includes('/podo_mail?'))return respond([{state:'leased'}]);sends++;throw Error('Nie wolno wysłać');};
 await flushMail({production:true});assert.equal(sends,0);assert.equal(patch.state,'cancelled');
}));
test('odwołana dzierżawa zadania nie powoduje wysyłki',async()=>setup(async()=>{
 let sends=0;global.fetch=async(url)=>{if(url.includes('/rpc/'))return respond([{id:'job',appointment_id:'visit',kind:'reminder',attempts:1}]);if(url.includes('/podo_appointments?'))return respond([{status:'confirmed',starts_at:'2036-09-28T08:00:00Z'}]);if(url.includes('/podo_mail?'))return respond([{state:'cancelled'}]);sends++;throw Error('Nie wolno wysłać');};
 await flushMail({production:true});assert.equal(sends,0);
}));
