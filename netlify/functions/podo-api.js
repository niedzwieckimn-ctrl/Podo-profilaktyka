import {json,admin,all,db,validateOrigin} from '../lib/backend.js';
import {flushMail,mailEnabled} from '../lib/mail.js';
import {advise} from '../lib/advisor.js';
import {uploadPhoto,photoUrl} from '../lib/photos.js';
import {validateEncounter,dayKey,time,validateRange} from '../../assets/domain.js';
import {validateClinicPatient} from '../../assets/clinic-profile.js';
export const handler=async event=>{
 try {
  if(event.httpMethod==='GET'&&event.queryStringParameters?.config==='1')return json(200,{url:process.env.SUPABASE_URL||'',key:process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||'',ai:!!process.env.OPENAI_API_KEY});
  if(!['GET','POST'].includes(event.httpMethod))return json(405,{error:'Niedozwolona metoda.'});
  const user=await admin(event);
  if(event.httpMethod==='GET') {
   const [patients,appointments,encounters,services,ideas,settings,mail,photos,cases]=await Promise.all(['podo_patients','podo_appointments','podo_encounters','podo_services','podo_ideas','podo_settings','podo_mail','podo_photos','podo_cases'].map(t=>all(t)));
   return json(200,{patients,appointments,encounters,services,ideas,settings:settings[0]?.data||{},mail,photos,cases,clinic_profile:true,notifications_configured:mailEnabled(),user:user.email});
  }
  validateOrigin(event);
  if((event.body||'').length>2900000)return json(413,{error:'Żądanie jest zbyt duże.'});
  const {action,data:d={}}=JSON.parse(event.body||'{}');
  if(action==='photo')return json(200,await uploadPhoto(d,user));
  if(action==='photo-url')return json(200,await photoUrl(d));
  if((event.body||'').length>65000)return json(413,{error:'Żądanie jest zbyt duże.'});
  if(action==='advisor')return json(200,await advise(d));
  if(!['patient','book','cancel','encounter','idea','service','settings','case','case-status'].includes(action))return json(400,{error:'Niedozwolona operacja.'});
  if(action==='patient')validateClinicPatient(d);
  if(action==='encounter')validateEncounter(d);
  if(action==='book') {const range=validateRange(dayKey(d.starts_at),time(d.starts_at),time(d.ends_at));if(range.starts_at!==d.starts_at||range.ends_at!==d.ends_at)throw Error('Nieprawidłowy zakres godzin.');}
  if(action==='service'&&(!d.name||!Number.isInteger(d.price)||d.price<0||!Number.isInteger(d.minutes)||d.minutes%30||d.minutes<30||d.minutes>720))throw Error('Sprawdź cenę i czas zabiegu.');
  if(action==='service'&&d.price_max!==undefined&&d.price_max!==null&&(!Number.isInteger(d.price_max)||d.price_max<d.price||d.price_max>10000000))throw Error('Sprawdź widełki ceny.');
  if(action==='book'&&d.price!==undefined&&(!Number.isInteger(d.price)||d.price<0||d.price>10000000))throw Error('Sprawdź kwotę wizyty.');
  if(action==='case'&&(!d.title?.trim()||!d.location?.trim()))throw Error('Podaj nazwę problemu i lokalizację.');
  if(action==='case-status'&&!['active','closed'].includes(d.status))throw Error('Nieprawidłowy status problemu.');
  const result=await db('rpc/podo_action',{method:'POST',body:{p_action:action,p_data:d,p_actor:user.id}});
  if(['book','cancel'].includes(action)) {
   // Zapis rezerwacji jest niezależny od zewnętrznego dostawcy poczty.
   try{result.notifications=await flushMail();}catch{result.notifications={configured:true,queued:true};}
  }
  return json(200,result);
 }catch(e){return json(e.status||400,{error:e.status===401||e.status===403?e.message:String(e.message||'Operacja nie powiodła się.').slice(0,220)});}
};
