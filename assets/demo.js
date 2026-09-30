import {SERVICES,dayKey,shiftDay,instant,overlaps,validatePatient,validateEncounter} from './domain.js';
export function seed() {
 const today=dayKey(), tomorrow=shiftDay(today,1), old=shiftDay(today,-28);
 const unknown={diabetes:'unknown',circulation:'unknown',neuropathy:'unknown',anticoagulants:'unknown',healing:'unknown'};
 const patients=[
  {id:'p1',name:'Anna Nowak',phone:'',email:'',birth_date:'1983-05-18',profile:{...unknown,diabetes:'yes',circulation:'no',neuropathy:'no',anticoagulants:'no',healing:'no',allergies:'Zgłasza uczulenie na lateks',medications:'Do aktualizacji przy kolejnej wizycie',complaints:'Nawracające zrogowacenia przodostopia.',footwear:'Pełne obuwie, wąski przód',workload:'Praca stojąca',wellbeing:'Preferuje spokojne wyjaśnienie kolejnych czynności',relationship:'Lubi spacery po lesie; zapytać, jak nowe wygodne obuwie.',interview_date:old},created_at:old+'T10:00:00Z'},
  {id:'p2',name:'Piotr Zieliński',phone:'',email:'',birth_date:'1991-09-04',profile:{...unknown,diabetes:'no',allergies:'Nie zgłasza',complaints:'Kontrola klamry na paluchu prawej stopy.',workload:'Praca siedząca, rekreacyjna jazda na rowerze',interview_date:old},created_at:old+'T10:00:00Z'},
  {id:'p3',name:'Ewa Malinowska',phone:'',email:'',birth_date:'1972-02-09',profile:{...unknown,allergies:'Do ustalenia',complaints:'Sucha skóra i pękające pięty.',interview_date:old},created_at:old+'T10:00:00Z'}
 ];
 const appointment=(id,patient_id,day,start,end,service)=>({id,patient_id,starts_at:instant(day,start),ends_at:instant(day,end),status:'confirmed',service_id:service.id,service_name:service.name,price:service.price,clinic_name:'PodoCare · gabinet podologiczny',clinic_address:'Przykładowa 12, Warszawa',patient_name:patients.find(p=>p.id===patient_id).name,patient_email:'',note:'',revision:1});
 const appointments=[appointment('a1','p1',today,'09:00','10:00',SERVICES[1]),appointment('a2','p2',today,'11:30','12:00',SERVICES[6]),appointment('a3','p3',today,'15:00','16:00',SERVICES[3]),appointment('a4','p2',tomorrow,'10:00','10:30',SERVICES[6])];
 const encounters=[{id:'v1',patient_id:'p1',appointment_id:null,created_at:old+'T09:00:00Z',observations:'Zrogowacenie przodostopia lewej stopy. Pacjentka nie zgłasza nowych dolegliwości.',performed:'Opracowanie zrogowaceń. Omówienie pielęgnacji i doboru obuwia.',aftercare:'Zalecenia indywidualne omówiono i przekazano pacjentce. Przy niepokojących zmianach kontakt z lekarzem.',products:'Krem do stóp — przykład dokumentacji',pain:2,zones:['L:Przodostopie'],followup_date:shiftDay(today,5),profile_snapshot:structuredClone(patients[0].profile),amount:18000,paid:true,amends_id:null},
 {id:'v2',patient_id:'p2',appointment_id:null,created_at:old+'T12:00:00Z',observations:'Kontrola palucha prawej stopy. Zgłaszany dyskomfort w obuwiu.',performed:'Kontrola klamry i omówienie dalszej obserwacji.',aftercare:'Kontrola w uzgodnionym terminie; nie manipulować przy klamrze.',products:'',pain:1,zones:['P:Paluch / paznokieć I'],followup_date:tomorrow,profile_snapshot:structuredClone(patients[1].profile),amount:8000,paid:true,amends_id:null}];
 return {patients,appointments,encounters,services:structuredClone(SERVICES),settings:{name:'PodoCare',address:'Przykładowa 12, Warszawa',phone:'',email:'',reminders:true},mail:[]};
}
export function demoAction(state,action,d) {
 const id=d.id||crypto.randomUUID(), now=new Date().toISOString();
 if(action==='patient') {
  validatePatient(d);const old=state.patients.find(p=>p.id===id);
  const p={...d,id,created_at:old?.created_at||now};
  if(old) Object.assign(old,p);else state.patients.push(p);return {id};
 }
 if(action==='book') {
  if(state.appointments.some(a=>a.id===id)) return {id,reused:true};
  const p=state.patients.find(p=>p.id===d.patient_id),s=state.services.find(s=>s.id===d.service_id);
  if(!p||!s) throw Error('Wybierz pacjenta i zabieg.');
  if(new Date(d.starts_at)<=new Date()) throw Error('Termin musi być w przyszłości.');
  if(state.appointments.some(a=>overlaps(a,d))) throw Error('Ten zakres jest już zajęty.');
  state.appointments.push({...d,id,status:'confirmed',patient_name:p.name,patient_email:p.email,service_name:s.name,price:s.price,clinic_name:state.settings.name,clinic_address:state.settings.address,revision:1});
  return {id,mail:'Tryb demonstracyjny — e-mail nie został wysłany.'};
 }
 if(action==='cancel') {
  const a=state.appointments.find(a=>a.id===d.id);if(!a||a.status!=='confirmed') throw Error('Nie można anulować tej wizyty.');
  a.status='cancelled';a.revision++;return {id:a.id};
 }
 if(action==='reschedule'){
  const a=state.appointments.find(a=>a.id===d.id);if(!a||a.status!=='confirmed')throw Error('Można przesunąć tylko aktywną wizytę.');
  if(state.appointments.some(x=>x.id!==a.id&&overlaps(x,d)))throw Error('Ten zakres jest już zajęty.');
  a.starts_at=d.starts_at;a.ends_at=d.ends_at;a.revision=(a.revision||1)+1;return {id:a.id};
 }
 if(action==='visit-note'){
  const a=state.appointments.find(a=>a.id===d.id);if(!a||a.status!=='confirmed')throw Error('Wizyta nie jest aktywna.');
  a.live_notes=String(d.live_notes||'');return {id:a.id};
 }
 if(action==='encounter') {
  validateEncounter(d);if(state.encounters.some(v=>v.id===id)) return {id,reused:true};
  const p=state.patients.find(p=>p.id===d.patient_id);if(!p) throw Error('Brak pacjenta.');
  if(d.appointment_id){const a=state.appointments.find(a=>a.id===d.appointment_id&&a.patient_id===p.id);if(!a||a.status!=='confirmed') throw Error('Wizyta nie jest aktywna.');a.status='completed';}
  state.encounters.push({...d,id,created_at:now,profile_snapshot:structuredClone(p.profile)});return {id};
 }
 if(action==='service'){const sid=d.service_id;const s=state.services.find(s=>s.id===sid);if(s)Object.assign(s,d);else state.services.push({...d,id:sid});return {id:sid};}
 if(action==='settings'){state.settings={...d};return {id:'clinic'};}
 throw Error('Nieznana czynność.');
}
