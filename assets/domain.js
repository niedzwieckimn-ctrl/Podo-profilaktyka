export const VERSION = '2.0.0';
export const ZONE = 'Europe/Warsaw';
export const STATUS = {confirmed:'Potwierdzona', completed:'Zakończona', cancelled:'Anulowana'};
export const RISKS = {diabetes:'Cukrzyca', circulation:'Problemy z krążeniem', neuropathy:'Zaburzenia czucia', anticoagulants:'Leki przeciwkrzepliwe', healing:'Utrudnione gojenie'};
export const TRI = {unknown:'Nie ustalono', no:'Nie zgłasza', yes:'Zgłasza'};
export const ZONES = ['Paluch / paznokieć I','Palce / paznokcie II–V','Przodostopie','Śródstopie','Pięta','Brzeg przyśrodkowy','Brzeg boczny'];
export const SERVICES = [
  {id:'consult',name:'Konsultacja podologiczna',category:'Diagnostyka i plan',minutes:30,price:10000},
  {id:'basic',name:'Podstawowy zabieg podologiczny',category:'Pielęgnacja stóp',minutes:60,price:18000},
  {id:'corn',name:'Opracowanie odcisku / modzela',category:'Skóra stóp',minutes:30,price:10000},
  {id:'heel',name:'Opracowanie pękających pięt',category:'Skóra stóp',minutes:60,price:15000},
  {id:'ingrown',name:'Opracowanie wrastającego paznokcia',category:'Paznokcie',minutes:60,price:18000},
  {id:'brace',name:'Założenie klamry ortonyksyjnej',category:'Paznokcie',minutes:60,price:22000},
  {id:'brace-check',name:'Kontrola klamry',category:'Wizyta kontrolna',minutes:30,price:8000},
  {id:'nails',name:'Opracowanie zmienionej płytki paznokcia',category:'Paznokcie',minutes:60,price:16000},
  {id:'check',name:'Wizyta kontrolna / zmiana opatrunku',category:'Wizyta kontrolna',minutes:30,price:8000}
];
export const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money = cents => new Intl.NumberFormat('pl-PL',{style:'currency',currency:'PLN',maximumFractionDigits:2}).format(Number(cents||0)/100);
export const dayKey = (v=new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
export const time = v => new Intl.DateTimeFormat('pl-PL',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(v));
export const date = v => new Intl.DateTimeFormat('pl-PL',{timeZone:ZONE,day:'numeric',month:'long',year:'numeric'}).format(new Date(String(v).length===10?v+'T12:00:00Z':v));
export const shiftDay = (v,n) => { const d=new Date(v+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
export const clock = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
// Zachowane reguły zaznaczania zakresu z aplikacji bazowej: 08–20, krok 30 minut.
export function selection(a,b,blocked=[]) {
  if(![a,b].every(Number.isInteger)||Math.min(a,b)<0||Math.max(a,b)>=24) return null;
  const first=Math.min(a,b),last=Math.max(a,b);
  if(blocked.slice(first,last+1).some(Boolean)) return null;
  return {first,last,start:clock(480+first*30),end:clock(510+last*30),minutes:(last-first+1)*30};
}
export function instant(day,hhmm) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{2}:(00|30)$/.test(hhmm)) throw Error('Nieprawidłowy termin.');
  const target=new Date(`${day}T${hhmm}:00Z`).getTime();
  if(!Number.isFinite(target)) throw Error('Nieprawidłowa data.');
  let guess=target;
  for(let i=0;i<3;i++) {
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(guess).map(x=>[x.type,x.value]));
    guess+=target-Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  }
  if(dayKey(guess)!==day||time(guess)!==hhmm) throw Error('Nieprawidłowy czas lokalny.');
  return new Date(guess).toISOString();
}
export function validateRange(day,start,end) {
  if(start<'08:00'||end>'20:00'||start>=end) throw Error('Wybierz zakres między 08:00 a 20:00.');
  return {starts_at:instant(day,start),ends_at:instant(day,end)};
}
export const overlaps = (a,b) => a.status!=='cancelled'&&b.status!=='cancelled'&&a.starts_at<b.ends_at&&a.ends_at>b.starts_at;
export function blockedCells(day,appointments,now=new Date()) {
  return Array.from({length:24},(_,i)=>{
    const range=validateRange(day,clock(480+i*30),clock(510+i*30));
    return new Date(range.starts_at)<=now||appointments.some(a=>overlaps(a,range));
  });
}
export function validatePatient(p) {
  if(!String(p.name||'').trim()) throw Error('Wpisz imię i nazwisko pacjenta.');
  if(p.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) throw Error('Sprawdź adres e-mail.');
  if(p.birth_date&&(p.birth_date>dayKey()||!/^\d{4}-\d{2}-\d{2}$/.test(p.birth_date))) throw Error('Sprawdź datę urodzenia.');
  return p;
}
export function validateEncounter(v) {
  for(const key of ['observations','performed','aftercare']) if(!String(v[key]||'').trim()) throw Error('Uzupełnij obserwacje, wykonane czynności i zalecenia.');
  if(v.pain!==null&&(!Number.isInteger(v.pain)||v.pain<0||v.pain>10)) throw Error('Ból musi być w zakresie 0–10.');
  return v;
}
export function isSaveIdeaCommand(text) {
  const t=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').toLowerCase().trim();
  return /^(prosze\s+)?(zapisz|dodaj)\b/.test(t)&&!/(pacjent|nazwisk|klient|rezerw|wywiad|dokumentac)/.test(t)&&t.length<160;
}
export function riskFlags(p) { return Object.entries(RISKS).filter(([k])=>p.profile?.[k]==='yes').map(([,v])=>v); }
export function redact(text,patients=[]) {
  let s=String(text||'').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[e-mail]').replace(/\+?\d[\d ()-]{7,}\d/g,'[numer]');
  const words=patients.flatMap(p=>[p.name,p.phone,p.email,p.address,...String(p.name||'').split(/\s+/)]).filter(v=>v&&v.length>=3).sort((a,b)=>b.length-a.length);
  for(const word of words) s=s.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu'),'[pacjent]');
  return s;
}
// Celowo bez nazwiska, daty urodzenia, kontaktu, adresu i opowieści z życia.
export function advisorContext(patient,encounters) {
  const profile={};
  for(const k of [...Object.keys(RISKS),'allergies','medications','complaints','footwear','workload']) profile[k]=patient.profile?.[k]??'Nie ustalono';
  const visits=encounters.filter(v=>v.patient_id===patient.id).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,6).map(v=>({date:v.created_at.slice(0,10),zones:v.zones,pain:v.pain,observations:v.observations,performed:v.performed,aftercare:v.aftercare,followup_date:v.followup_date}));
  return JSON.parse(redact(JSON.stringify({profile,visits}),[patient]));
}
