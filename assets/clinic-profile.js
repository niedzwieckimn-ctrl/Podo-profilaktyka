import {dayKey,shiftDay,money,validatePatient} from './domain.js';

// Publiczny profil gabinetu. personalizeDemo dodaje wyłącznie fikcyjne dane w pamięci.
export const CLINIC = {
 name:'Podo-Profilaktyka', practitioner:'Katarzyna Kosak', greeting:'Miło Cię widzieć',
 address:'Orląt Lwowskich 72K, 25-437 Kielce', phone:'+48 664 010 384', email:'podo-profilaktyka@onet.eu',
 website:'https://podologkielce.com.pl/', logo:'assets/podo-profilaktyka-logo.png',
 priceSource:'https://podologkielce.com.pl/cennik-podolog-kielce-gabinet-podologiczny-kielce-podo-profilaktyka/',
 checked:'2026-09-28', hours:'Pon.–pt. 08:00–20:00 · sob.–niedz. 15:00–20:00 (do potwierdzenia)'
};
// Kwoty z publicznego cennika. Czasy są robocze — nie pochodzą z cennika gabinetu.
const entries = [
 ['consult','Konsultacja podologiczna','Konsultacje',30,70,70,'Bezpłatna w ramach zabiegu'],
 ['check','Kontrolna wizyta podologiczna','Konsultacje',30,70,70,''],
 ['mycology','Pobranie próbki z paznokcia — badanie mykologiczne','Badania',30,160,160,''],
 ['basic','Podstawowy zabieg podologiczny','Zabiegi podstawowe',60,160,160,''],
 ['special','Specjalistyczny zabieg podologiczny','Zabiegi podstawowe',60,180,200,'Zakres do ustalenia podczas wizyty'],
 ['cosmetic','Podstawowy zabieg kosmetyczny','Zabiegi podstawowe',60,150,150,''],
 ['diabetic','Pielęgnacja stopy cukrzycowej','Zabiegi podstawowe',60,150,180,'Po indywidualnej kwalifikacji'],
 ['callus','Usunięcie modzela','Zmiany skórne',30,80,80,'Do dwóch zmian'],
 ['callus-many','Usunięcie modzeli — powyżej dwóch','Zmiany skórne',60,110,110,''],
 ['corn','Usunięcie odcisku','Zmiany skórne',30,90,90,'Bez odciążenia'],
 ['corn-relief','Usunięcie odcisku z odciążeniem','Zmiany skórne',30,120,120,''],
 ['corn-many','Usunięcie odcisków — powyżej dwóch','Zmiany skórne',60,150,150,''],
 ['heel','Opracowanie pękających pięt','Zmiany skórne',60,160,160,''],
 ['nail-cut','Obcięcie płytki paznokciowej','Paznokcie',30,40,40,''],
 ['nail-fold','Obcięcie paznokci i opracowanie wałów','Paznokcie',30,60,80,''],
 ['nails','Oczyszczenie płytki zmienionej chorobowo','Paznokcie',60,150,220,''],
 ['onycholysis','Terapia onycholizy — jeden paznokieć','Paznokcie',30,100,100,''],
 ['onycholysis-two','Terapia onycholizy — dwa paznokcie','Paznokcie',60,180,180,''],
 ['reconstruction','Rekonstrukcja płytki — jeden paznokieć','Paznokcie',30,90,90,''],
 ['reconstruction-remove','Usunięcie masy rekonstrukcyjnej','Paznokcie',30,50,50,''],
 ['hematoma','Ewakuacja krwiaka podpaznokciowego','Paznokcie',30,80,100,'Wskazany na stronie zakres: do 48 h; wymaga kwalifikacji'],
 ['relief','Odciążenie','Odciążenia i opatrunki',30,30,60,''],
 ['dressing','Opatrunek z preparatem','Odciążenia i opatrunki',30,40,80,''],
 ['heel-dressing','Terapia pięt z odciążeniem i opatrunkiem','Odciążenia i opatrunki',60,180,200,''],
 ['wart','Usunięcie brodawki wirusowej','Terapie specjalistyczne',30,100,100,'Odciążenie dodatkowo 20 zł'],
 ['warts','Usunięcie brodawek mnogich','Terapie specjalistyczne',60,150,200,''],
 ['ingrown','Opracowanie wrastającego paznokcia + opatrunek','Terapie specjalistyczne',60,100,160,'Jeden / dwa palce'],
 ['ingrown-check','Kontrola wrastającego paznokcia / zmiana opatrunku','Terapie specjalistyczne',30,90,90,''],
 ['tamponade','Aplikacja tamponady','Terapie specjalistyczne',30,30,null,'Cena od 30 zł'],
 ['brace','Założenie klamry tytanowej / Frasera','Klamry',60,170,220,''],
 ['brace-check','Przełożenie klamry drutowej','Klamry',30,90,90,''],
 ['onyclip','Założenie klamry OnyClip','Klamry',30,120,120,''],
 ['combiped','Założenie klamry Combi-ped / Podofix','Klamry',30,120,140,''],
 ['taping','Taping podologiczny','Dodatkowe',30,60,80,''],
 ['orthosis','Ortozy indywidualne','Dodatkowe',30,50,90,''],
 ['lymph','Drenaż limfatyczny kończyn dolnych','Dodatkowe',30,40,40,'30 minut podane w cenniku'],
 ['massage','Masaż podologiczny kończyny dolnej','Dodatkowe',30,50,50,'Cena za jedną nogę']
];
export const CLINIC_SERVICES=entries.map(([id,name,category,minutes,min,max,price_note])=>({id,name,category,minutes,price:min*100,price_max:max===null?null:max*100,price_note,time_confirmed:id==='lymph'}));
export const priceLabel=s=>s.price_max===null?`od ${money(s.price)}`:s.price_max!==undefined&&s.price_max!==s.price?`${money(s.price)}–${money(s.price_max)}`:money(s.price);
export function isMinor(patient,on=dayKey()){
 if(!patient.birth_date)return patient.profile?.patient_kind==='child';
 const [y,m,d]=on.split('-').map(Number),[by,bm,bd]=patient.birth_date.split('-').map(Number);
 return y-by-((m<bm||m===bm&&d<bd)?1:0)<18;
}
export function validateClinicPatient(p){
 validatePatient(p);const v=p.profile||{};
 if(isMinor(p)||v.contact_target==='guardian'){
  if(!v.guardian_name?.trim()||!v.guardian_relation?.trim())throw Error('Uzupełnij imię i nazwisko opiekuna oraz relację do pacjenta.');
  if(!v.guardian_phone?.trim()&&!v.guardian_email?.trim())throw Error('Podaj telefon lub e-mail opiekuna.');
 }
 if(v.guardian_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.guardian_email))throw Error('Sprawdź e-mail opiekuna.');
 return p;
}
export const contactFor=p=>(isMinor(p)||p.profile?.contact_target==='guardian')?{name:p.profile.guardian_name,email:p.profile.guardian_email||'',phone:p.profile.guardian_phone||'',kind:'opiekun'}:{name:p.name,email:p.email||'',phone:p.phone||'',kind:'pacjent'};
export function validateLinks(state,pid,caseId='',encounterId='',appointmentId=''){
 if(!state.patients.some(p=>p.id===pid))throw Error('Nie znaleziono pacjenta.');
 if(caseId&&!state.cases?.some(c=>c.id===caseId&&c.patient_id===pid))throw Error('Problem musi należeć do tego pacjenta.');
 if(encounterId){const v=state.encounters.find(v=>v.id===encounterId&&v.patient_id===pid);if(!v)throw Error('Wizyta musi należeć do tego pacjenta.');if((v.case_id||'')!==(caseId||''))throw Error('Wybrana wizyta dotyczy innego problemu.');}
 if(appointmentId){const a=state.appointments.find(a=>a.id===appointmentId&&a.patient_id===pid);if(!a)throw Error('Termin musi należeć do tego pacjenta.');if(a.case_id&&(a.case_id||'')!==(caseId||''))throw Error('Wybrany termin dotyczy innego problemu.');}
}
const distanceToAppointment=(a,now)=>{const n=now.getTime(),start=new Date(a.starts_at).getTime(),end=new Date(a.ends_at).getTime();return n<start?start-n:n>end?n-end:0;};
export function suggestPhotoContext(state,pid,now=new Date(),preferred={}){
 const patient=state.patients.find(p=>p.id===pid);if(!patient)throw Error('Nie znaleziono pacjenta.');
 const appointments=(state.appointments||[]).filter(a=>a.patient_id===pid&&a.status!=='cancelled');
 const encounters=(state.encounters||[]).filter(v=>v.patient_id===pid);
 const preferredEncounter=preferred.encounter_id&&encounters.find(v=>v.id===preferred.encounter_id);
 const preferredAppointment=preferred.appointment_id&&appointments.find(a=>a.id===preferred.appointment_id);
 const current=appointments.filter(a=>new Date(a.starts_at)<=now&&new Date(a.ends_at)>=now).sort((a,b)=>a.starts_at.localeCompare(b.starts_at))[0];
 const sameDay=appointments.filter(a=>dayKey(a.starts_at)===dayKey(now)).sort((a,b)=>distanceToAppointment(a,now)-distanceToAppointment(b,now))[0];
 const last=appointments.filter(a=>new Date(a.starts_at)<=now).sort((a,b)=>b.starts_at.localeCompare(a.starts_at))[0];
 const appointment=preferredAppointment||(preferredEncounter?.appointment_id&&appointments.find(a=>a.id===preferredEncounter.appointment_id))||current||sameDay||last||null;
 const encounter=preferredEncounter||encounters.find(v=>v.appointment_id&&v.appointment_id===appointment?.id)||(!appointment&&encounters.sort((a,b)=>b.created_at.localeCompare(a.created_at))[0])||null;
 const activeCases=(state.cases||[]).filter(c=>c.patient_id===pid&&c.status==='active').sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const caseId=preferred.case_id||encounter?.case_id||appointment?.case_id||(activeCases.length===1?activeCases[0].id:'');
 return {patient_id:pid,case_id:caseId||'',encounter_id:encounter?.id||'',appointment_id:appointment?.id||'',phase:'control',taken_on:appointment?dayKey(appointment.starts_at):encounter?dayKey(encounter.created_at):dayKey(now)};
}
export function clinicAction(state,action,data){
 if(!state.clinic_demo)throw Error('Rozszerzenie dostępne tylko w dopasowanym demo.');
 if(action==='case'){
  validateLinks(state,data.patient_id);if(!data.title?.trim()||!data.location?.trim())throw Error('Podaj nazwę problemu i miejsce na stopie.');
  if(state.cases.some(c=>c.id===data.id))return {id:data.id,reused:true};
  state.cases.push({...data,status:'active',created_at:new Date().toISOString()});return {id:data.id};
 }
 if(action==='case-status'){
  const c=state.cases.find(c=>c.id===data.id&&c.patient_id===data.patient_id);if(!c)throw Error('Nie znaleziono problemu.');
  if(!['active','closed'].includes(data.status))throw Error('Nieprawidłowy status.');
  c.status=data.status;c.status_history||=[];c.status_history.push({status:data.status,at:new Date().toISOString()});return {id:c.id};
 }
 throw Error('Nieznana czynność demo.');
}
export function personalizeDemo(state){
 const today=dayKey(),old=shiftDay(today,-28),recent=shiftDay(today,-7);
 state.clinic_demo=true;state.clinic_profile=true;state.services=structuredClone(CLINIC_SERVICES);
 state.settings={...state.settings,...CLINIC};
 state.patients.push({id:'p4',name:'Zosia Wiśniewska',phone:'',email:'',birth_date:'2017-04-12',created_at:old+'T10:00:00Z',profile:{patient_kind:'child',contact_target:'guardian',guardian_name:'Marta Wiśniewska',guardian_relation:'Matka',guardian_phone:'',guardian_email:'opiekun@example.invalid',child_comfort:'Najpierw pokaż narzędzia. Mama pozostaje obok. Pacjentka lubi opowieści o zwierzętach.',allergies:'Do ponownego ustalenia z opiekunem',complaints:'Kontrola zmiany na lewej pięcie — fikcyjny przykład.',interview_date:old}});
 state.cases=[
  {id:'c1',patient_id:'p1',title:'Nawracające zrogowacenia',location:'Lewa stopa · przodostopie',goal:'Dokumentowanie dolegliwości i kolejnych kontroli.',status:'active',created_at:old+'T08:00:00Z'},
  {id:'c2',patient_id:'p2',title:'Kontrole klamry',location:'Prawa stopa · paluch / paznokieć I',goal:'Jedna oś czasu: obserwacje, klamra, zalecenia i fotografie.',status:'active',created_at:old+'T08:00:00Z'},
  {id:'c3',patient_id:'p4',title:'Obserwacja zmiany skórnej',location:'Lewa stopa · pięta',goal:'Kontrole z udziałem opiekuna — przykład, nie rozpoznanie.',status:'active',created_at:old+'T08:00:00Z'}
 ];
 state.encounters[0].case_id='c1';state.encounters[1].case_id='c2';
 state.encounters.push({...structuredClone(state.encounters[1]),id:'v3',created_at:recent+'T12:00:00Z',observations:'Fikcyjna kontrola: zapis relacji pacjenta i porównanie dokumentacji.',performed:'Kontrola klamry — wpis demonstracyjny.',case_id:'c2'});
 state.photos=[
  {id:'demo-before',patient_id:'p2',case_id:'c2',encounter_id:'v2',phase:'before',taken_on:old,created_at:old+'T12:00:00Z',url:'assets/demo-foot-before.svg',illustration:true},
  {id:'demo-control',patient_id:'p2',case_id:'c2',encounter_id:'v3',phase:'control',taken_on:recent,created_at:recent+'T12:00:00Z',url:'assets/demo-foot-control.svg',illustration:true}
 ];
 for(const a of state.appointments){const s=state.services.find(s=>s.id===a.service_id),caseId=a.patient_id==='p1'?'c1':a.patient_id==='p2'?'c2':a.patient_id==='p4'?'c3':'';Object.assign(a,{clinic_name:CLINIC.name,clinic_address:CLINIC.address,service_name:s?.name||a.service_name,price:s?.price||a.price,case_id:caseId});}
 return state;
}
