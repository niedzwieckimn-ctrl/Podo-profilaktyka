import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {db} from './backend.js';
import {dayKey} from '../../assets/domain.js';
const BUCKET='podo-patient-photos';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export async function preparePhoto(base64) {
 if(typeof base64!=='string'||base64.length>2800000||!base64.length)throw Error('Zdjęcie jest zbyt duże. Limit po przygotowaniu: 2 MB.');
 const source=Buffer.from(base64,'base64');
 if(source.length>2097152)throw Error('Przekroczono limit zdjęcia.');
 let result;
 try{result=await sharp(source,{limitInputPixels:16000000,failOn:'error'}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer({resolveWithObject:true});}
 catch{throw Error('Nie można odczytać zdjęcia. Wybierz poprawny plik JPEG, PNG lub WebP.');}
 if(result.data.length>2097152)throw Error('Zdjęcie po kompresji jest zbyt duże.');
 return {buffer:result.data,width:result.info.width,height:result.info.height,sha256:createHash('sha256').update(result.data).digest('hex')};
}
async function storage(path,method,body){
 const r=await fetch(`${process.env.SUPABASE_URL}/storage/v1/${path}`,{method,headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':Buffer.isBuffer(body)?'image/jpeg':'application/json','cache-control':'0'},body:Buffer.isBuffer(body)?body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const result=await r.json().catch(()=>({}));
 if(!r.ok)throw Object.assign(Error('Nie udało się zapisać lub otworzyć prywatnego zdjęcia. Sprawdź migrację Storage.'),{status:502,duplicate:result.error==='Duplicate'||Number(result.statusCode)===409||r.status===409});return result;
}
export async function photoContext(d){
 const context={case_id:d.case_id||null,encounter_id:d.encounter_id||null,phase:d.phase||'control',taken_on:d.taken_on||dayKey()};
 for(const id of [context.case_id,context.encounter_id])if(id&&!uuid(id))throw Error('Nieprawidłowe powiązanie zdjęcia.');
 const parsed=new Date(context.taken_on+'T12:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(context.taken_on)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==context.taken_on||context.taken_on>dayKey()||!['before','control','after'].includes(context.phase))throw Error('Sprawdź datę i etap zdjęcia.');
 if(context.case_id){const c=(await db(`podo_cases?id=eq.${context.case_id}&select=patient_id`))[0];if(c?.patient_id!==d.patient_id)throw Error('Problem musi należeć do tego pacjenta.');}
 if(context.encounter_id){const v=(await db(`podo_encounters?id=eq.${context.encounter_id}&select=patient_id,case_id`))[0];if(v?.patient_id!==d.patient_id||(v.case_id||null)!==context.case_id)throw Error('Wizyta dotyczy innego pacjenta lub problemu.');}
 return context;
}
export async function uploadPhoto(d,user){
 if(!uuid(d.id)||!uuid(d.patient_id))throw Error('Nieprawidłowa karta pacjenta.');
 const p=await db(`podo_patients?id=eq.${d.patient_id}&select=id`);if(!p.length)throw Error('Nie znaleziono pacjenta.');
 const context=await photoContext(d); // Walidacja przed zapisaniem obiektu w Storage.
 const photo=await preparePhoto(d.base64),path=`${d.patient_id}/${d.id}.jpg`;
 const save=()=>db('rpc/podo_add_photo',{method:'POST',body:{p_actor:user.id,p_data:{id:d.id,patient_id:d.patient_id,storage_path:path,sha256:photo.sha256,width:photo.width,height:photo.height,...context}}});
 const old=(await db(`podo_photos?id=eq.${d.id}&select=*`))[0];
 if(old){if(old.patient_id!==d.patient_id||old.sha256!==photo.sha256)throw Error('Konflikt zdjęcia.');return save();}
 // Nigdy nie nadpisujemy obiektu: retry sprawdza identyczność już zapisanych bajtów.
 try{await storage(`object/${BUCKET}/${path}`,'POST',photo.buffer);}catch(e){
  if(!e.duplicate)throw e;
  const existing=await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${path}`,{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`},signal:AbortSignal.timeout(15000)});
  if(!existing.ok||createHash('sha256').update(Buffer.from(await existing.arrayBuffer())).digest('hex')!==photo.sha256)throw Error('Konflikt zdjęcia. Istniejący plik nie został nadpisany.');
 }
 return save();
}
export async function photoUrl(d){
 if(!uuid(d.id))throw Error('Nieprawidłowe zdjęcie.');
 const record=(await db(`podo_photos?id=eq.${d.id}&select=*`))[0];if(!record)throw Error('Nie znaleziono zdjęcia.');
 const result=await storage(`object/sign/${BUCKET}/${record.storage_path}`,'POST',{expiresIn:90});
 return {url:`${process.env.SUPABASE_URL}/storage/v1${result.signedURL}`,expires_in:90};
}
