import {db} from './backend.js';
import {date,time,esc} from '../../assets/domain.js';
import {productionBuild} from './deploy-context.js';
// Jawne uruchomienie wyłącznie dla opublikowanego panelu, nigdy dla Deploy Preview.
export const mailEnabled=(production=productionBuild)=>production&&process.env.EMAIL_DELIVERY_ENABLED==='true'&&!!process.env.RESEND_API_KEY&&!!process.env.FROM_EMAIL;
export function emailContent(a,kind) {
 const title={confirmed:'Wizyta potwierdzona',cancelled:'Wizyta anulowana',reminder:'Przypomnienie o wizycie'}[kind];
 const sentence=kind==='cancelled'?'Rezerwacja została anulowana. Jeśli chcesz ustalić nowy termin, skontaktuj się z gabinetem.':'Zabierz listę przyjmowanych leków i informacje o alergiach. Jeśli Twój stan zdrowia zmienił się od ostatniej wizyty, poinformuj o tym osobę prowadzącą przed zabiegiem.';
 const when=`${date(a.starts_at)}, ${time(a.starts_at)}–${time(a.ends_at)}`;
 // W wiadomościach celowo nie ma rozpoznań, nazw zabiegów, zdjęć ani wywiadu.
 return {subject:`${title} · ${a.clinic_name}`,text:`${title}\n${when}\n${a.clinic_name}\n${a.clinic_address}\n\n${sentence}`,html:`<!doctype html><html lang="pl"><meta name="color-scheme" content="light dark"><body style="margin:0;background:#f3f5f1;color:#172e2a;font-family:Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px"><table role="presentation" width="100%" style="max-width:580px;background:#fff;border:1px solid #d7e1d9"><tr><td style="background:#1e5148;padding:28px;color:#fff;font-size:22px">${esc(a.clinic_name)}</td></tr><tr><td style="padding:30px;color:#172e2a"><h1 style="font-size:26px">${title}</h1><p style="font-size:20px;font-weight:bold">${esc(when)}</p><p>${esc(a.clinic_address)}</p><hr style="border:0;border-top:1px solid #d7e1d9"><p style="line-height:1.7">${esc(sentence)}</p></td></tr></table></td></tr></table></body></html>`};
}
export async function flushMail({production=productionBuild}={}) {
 if(!mailEnabled(production))return {configured:false,sent:0};
 const jobs=await db('rpc/podo_claim_mail',{method:'POST',body:{}});let sent=0;const deadline=Date.now()+18000;
 for(const job of jobs) {
  if(Date.now()>deadline)break; // Pozostałe lease wrócą do kolejki. Limit Scheduled Function: 30 s.
  try {
   const a=(await db(`podo_appointments?id=eq.${job.appointment_id}&select=*`))[0];
   const current=(await db(`podo_mail?id=eq.${job.id}&select=state`))[0];
   if(current?.state!=='leased')continue;
   const valid=a&&(job.kind==='cancelled'?a.status==='cancelled':a.status==='confirmed'&&new Date(a.starts_at)>new Date());
   if(!valid){await db(`podo_mail?id=eq.${job.id}`,{method:'PATCH',body:{state:'cancelled'}});continue;}
   const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`podocare-${job.id}`},body:JSON.stringify({from:process.env.FROM_EMAIL,to:[a.patient_email],...(process.env.REPLY_TO_EMAIL?{reply_to:process.env.REPLY_TO_EMAIL}:{}),...emailContent(a,job.kind)}),signal:AbortSignal.timeout(10000)});
   const result=await r.json();if(!r.ok)throw Error(`Resend HTTP ${r.status}`);
   await db(`podo_mail?id=eq.${job.id}`,{method:'PATCH',body:{state:'sent',provider_id:result.id,sent_at:new Date().toISOString(),last_error:null}});sent++;
  } catch {await db(`podo_mail?id=eq.${job.id}&state=eq.leased`,{method:'PATCH',body:{state:job.attempts>=5?'failed':'pending',due_at:new Date(Date.now()+600000).toISOString(),last_error:'Nie potwierdzono wysyłki. Sprawdź konfigurację i dostawcę.'}});}
 }
 return {configured:true,sent};
}
