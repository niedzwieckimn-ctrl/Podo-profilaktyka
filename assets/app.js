import {esc,dayKey,date,time,clock,shiftDay,blockedCells,selection,validateRange,money,RISKS,TRI,validatePatient,validateEncounter} from './domain.js';
import {seed,demoAction} from './demo.js';
import * as ui from './ui.js';
import {photoSection,compressPhoto} from './photos.js';
import {personalizeDemo,clinicAction,validateClinicPatient,validateLinks,contactFor,priceLabel,suggestPhotoContext} from './clinic-profile.js';
import * as clinic from './clinic-ui.js';
const root=document.querySelector('#root'),modal=document.querySelector('#modal'),toastBox=document.querySelector('#toast');
const demo=new URLSearchParams(location.search).get('demo')==='1';
let state,session,config,busy=false,selected=dayKey(),month=selected.slice(0,7),patientTab='overview',search='',installPrompt,activeAppointmentId='',activeShowChoices=false;
let range={day:selected,first:null,last:null,patient:''};
let caseFilter='',photoCase='',photoEncounter='';
const photoUrls=new Map();let pendingPhoto=null;
const route=()=>location.hash.slice(1)||'dashboard';
const toast=(text)=>{toastBox.textContent=text;toastBox.classList.add('show');clearTimeout(toastBox.timer);toastBox.timer=setTimeout(()=>toastBox.classList.remove('show'),5500);};
async function api(action,data={}) {
 if(demo&&action==='photo'){
  if(state.clinic_profile)validateLinks(state,data.patient_id,data.case_id,data.encounter_id,data.appointment_id);
  state.photos||=[];if(!state.photos.some(p=>p.id===data.id))state.photos.push({id:data.id,patient_id:data.patient_id,case_id:data.case_id||'',encounter_id:data.encounter_id||'',appointment_id:data.appointment_id||'',phase:data.phase||'control',taken_on:data.taken_on||dayKey(),created_at:new Date().toISOString(),url:URL.createObjectURL(data.blob)});return {id:data.id};
 }
 if(demo){
  if(state.clinic_profile){
   if(['case','case-status'].includes(action))return clinicAction(state,action,data);
   if(action==='patient')validateClinicPatient(data);
   if(action==='settings')data={...state.settings,...data};
   if(action==='encounter')validateLinks(state,data.patient_id,data.case_id);
   if(action==='book'){
    const p=state.patients.find(p=>p.id===data.patient_id);if(!p)throw Error('Wybierz pacjenta.');validateClinicPatient(p);
    if(!Number.isInteger(data.price)||data.price<0||data.price>10000000)throw Error('Podaj uzgodnioną cenę wizyty.');
    const receipt=demoAction(state,action,data);if(!receipt.reused)Object.assign(state.appointments.find(a=>a.id===receipt.id),{price:data.price,patient_email:contactFor(p).email,contact_snapshot:contactFor(p)});return receipt;
   }
  }
  return demoAction(state,action,data);
 }
 if(!session)throw Error('Zaloguj się ponownie.');
 if(Date.now()>session.expires_at-60000) {
  const r=await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});
  if(!r.ok){session=null;state=null;pendingPhoto=null;photoUrls.clear();modal.close();showLogin('Sesja wygasła. Zaloguj się ponownie.');throw Error('Sesja wygasła.');}
  session={...await r.json(),expires_at:Date.now()+3600000};
 }
 const r=await fetch('/.netlify/functions/podo-api',{method:action?'POST':'GET',headers:{Authorization:`Bearer ${session.access_token}`,...(action?{'Content-Type':'application/json'}:{})},body:action?JSON.stringify({action,data}):undefined});
 const result=await r.json().catch(()=>({error:'Serwer nie zwrócił odpowiedzi JSON.'}));
 if(!r.ok)throw Error(result.error||'Operacja nie powiodła się.');return result;
}
async function refresh(){if(!demo)state=await api();render();}
function render(){
 if(!state)return;
 root.innerHTML=ui.shell(route(),demo,state.settings,state.user);
 const r=route(),content=document.querySelector('#content'),pid=r.split('/')[1]?.split('?')[0];
 const views={dashboard:()=>ui.dashboard(state),active:()=>ui.activeVisit(state,activeAppointmentId,activeShowChoices),calendar:()=>ui.calendar(state,selected,month),patients:()=>ui.patients(state,search),settings:()=>ui.settings(state,demo)};
 content.innerHTML=r.startsWith('patient/')?ui.patient(state,pid,patientTab==='cases'?'photos':patientTab):r==='settings/services'?(state.clinic_profile?clinic.clinicServices(state):ui.services(state)):r==='settings/finance'?ui.finance(state):(views[r]||views.dashboard)();
 if(r.startsWith('settings/'))content.insertAdjacentHTML('afterbegin','<a href="#settings" class="back-link">← Ustawienia</a>');
 if(state.clinic_profile)clinic.applyClinicTheme(root,state,r);
 if(r.startsWith('patient/')){
  if(state.clinic_profile){
   const p=state.patients.find(p=>p.id===pid);
   if(p){
    const tabs=content.querySelector('.tabs');tabs.firstElementChild.insertAdjacentHTML('afterend',`<button data-patient-tab="cases" class="${patientTab==='cases'?'active':''}">Terapie</button>`);tabs.querySelector('[data-patient-tab="cases"]').after(tabs.querySelector('[data-patient-tab="photos"]'));
    content.querySelector('.tabs').insertAdjacentHTML('afterend',clinic.guardianCard(p));
    if(patientTab==='cases')content.insertAdjacentHTML('beforeend',clinic.casePanel(state,pid,caseFilter));
    if(patientTab==='overview')content.querySelector('.tabs').insertAdjacentHTML('afterend',`<div class="case-quick"><span>Problemy w toku: ${state.cases.filter(c=>c.patient_id===pid&&c.status==='active').length}</span><button class="text-button" data-patient-tab="cases">Otwórz terapie i kontrole →</button></div>`);
    if(patientTab==='history')content.querySelectorAll('.history-entry').forEach((el,i)=>{const v=state.encounters.filter(v=>v.patient_id===pid).sort((a,b)=>b.created_at.localeCompare(a.created_at))[i],c=state.cases.find(c=>c.id===v.case_id);if(c)el.querySelector('.history-body').insertAdjacentHTML('afterbegin',`<span class="tag">${esc(c.title)} · ${esc(c.location)}</span>`);});
    if(patientTab!=='cases')content.insertAdjacentHTML('beforeend',clinic.clinicPhotoSection(state,pid,photoCase,photoEncounter));
   }
  }else content.insertAdjacentHTML('beforeend',photoSection(state,pid));
  hydratePhotos();
 }
 if(r==='active'&&activeAppointmentId){const a=state.appointments.find(a=>a.id===activeAppointmentId&&a.status==='confirmed');if(a){content.insertAdjacentHTML('beforeend',clinic.clinicPhotoSection(state,a.patient_id,a.case_id||'',''));hydratePhotos();}}
}
async function getPhotoUrl(id){
 const cached=photoUrls.get(id);if(cached&&cached.until>Date.now())return cached.url;
 const url=demo?state.photos.find(p=>p.id===id)?.url:(await api('photo-url',{id})).url;
 photoUrls.set(id,{url,until:Date.now()+60000});return url;
}
async function hydratePhotos(){
 for(const img of document.querySelectorAll('img[data-photo]')){
  try{img.onload=()=>{img.hidden=false;img.previousElementSibling.hidden=true;};img.onerror=()=>{img.previousElementSibling.textContent='Zdjęcie niedostępne. Kliknij, aby ponowić.';};img.src=await getPhotoUrl(img.dataset.photo);}
  catch{img.previousElementSibling.textContent='Nie udało się wczytać. Kliknij, aby ponowić.';}
 }
}
async function uploadPendingPhoto(){
 if(!pendingPhoto)return;
 const d=pendingPhoto;
 try{await api('photo',demo?d:{id:d.id,patient_id:d.patient_id,base64:d.base64,case_id:d.case_id,encounter_id:d.encounter_id,appointment_id:d.appointment_id,phase:d.phase,taken_on:d.taken_on});}
 catch(e){showModal('Zdjęcie nie zostało zapisane',`<div class="padded"><p>${esc(e.message)}</p><p>Zdjęcie pozostaje w pamięci tej otwartej strony. Możesz ponowić zapis przy tym samym pacjencie.</p><div class="form-actions"><button class="outline" data-close>Zamknij</button><button class="primary" data-retry-photo>Ponów zapis</button></div></div>`);throw e;}
 if(d.preview_url)URL.revokeObjectURL(d.preview_url);pendingPhoto=null;
 try{await refresh();toast(demo?'Zdjęcie dodano do karty w demo (do odświeżenia).':'Zdjęcie zapisano w karcie pacjenta.');}catch{toast('Zdjęcie zapisano, ale nie odświeżono galerii. Wczytaj ponownie kartę pacjenta.');}
}
function showModal(title,body,wide=false){
 modal.innerHTML=`<div class="modal-heading"><div><span class="eyebrow">PODOCARE</span><h2>${title}</h2></div><button class="icon-button" data-close aria-label="Zamknij">${ui.icon('close')}</button></div>${body}`;
 modal.className=wide?'wide':'';if(!modal.open)modal.showModal();
}
const input=(title,name,value='',attrs='')=>`<label>${title}<input name="${name}" value="${esc(value)}" ${attrs}></label>`;
const textarea=(title,name,value='',attrs='')=>`<label class="full-span">${title}<textarea name="${name}" maxlength="6000" ${attrs}>${esc(value)}</textarea></label>`;
const formButtons=(label='Zapisz')=>`<div class="form-actions full-span"><button type="button" class="outline" data-close>Anuluj</button><button class="primary" type="submit">${label}</button></div><p class="form-error full-span" role="alert"></p>`;
function wireFootMap(container,{single=false,onSelect}={}){
 const checks=[...container.querySelectorAll('input[name="zones"]')],dots=[...container.querySelectorAll('[data-zone-pick]')];
 const sync=()=>{dots.forEach(dot=>dot.classList.toggle('marked',checks.some(c=>c.value===dot.dataset.zonePick&&c.checked)));};
 for(const dot of dots)dot.onclick=()=>{const check=checks.find(c=>c.value===dot.dataset.zonePick);if(!check)return;if(single)checks.forEach(c=>c.checked=false);check.checked=!check.checked;check.dispatchEvent(new Event('change',{bubbles:true}));};
 for(const check of checks)check.onchange=()=>{if(single&&check.checked)checks.forEach(c=>{if(c!==check)c.checked=false;});sync();onSelect?.(checks.find(c=>c.checked)?.value||'');};
 sync();return checks;
}
function openRange(day,patient=''){
 range={day:day||selected,first:null,last:null,patient};
 const blocked=blockedCells(range.day,state.appointments);
 showModal('Wybierz czas wizyty',`<div class="padded"><label>Dzień wizyty<input type="date" id="range-day" value="${range.day}" min="${dayKey()}"></label><p class="muted">Przeciągnij myszką lub palcem po godzinach. Możesz też wskazać początek i koniec w polach poniżej.</p><div class="time-grid" role="group" aria-label="Godziny wizyty">${blocked.map((b,i)=>`<button class="time-cell" data-cell="${i}" ${b?'disabled':''}>${clock(480+i*30)}<small>– ${clock(510+i*30)}</small></button>`).join('')}</div><div class="range-fields"><label>Od<select id="range-start"><option value="">Wybierz</option>${blocked.map((b,i)=>`<option value="${i}" ${b?'disabled':''}>${clock(480+i*30)}</option>`).join('')}</select></label><label>Do<select id="range-end"><option value="">Wybierz</option>${blocked.map((b,i)=>`<option value="${i}" ${b?'disabled':''}>${clock(510+i*30)}</option>`).join('')}</select></label></div><div class="range-summary" id="range-summary" aria-live="polite">Zaznacz zakres — minimum 30 minut.</div><div class="form-actions"><button class="outline" data-close>Anuluj</button><button class="primary" id="range-next" disabled>Dalej · dane wizyty →</button></div></div>`);
 let dragging=false,start=null;
 const grid=modal.querySelector('.time-grid');
 const paint=(a,b)=>{
  const sel=selection(a,b,blocked);range.first=sel?.first??null;range.last=sel?.last??null;
  grid.querySelectorAll('[data-cell]').forEach(el=>el.classList.toggle('picked',!!sel&&Number(el.dataset.cell)>=sel.first&&Number(el.dataset.cell)<=sel.last));
  modal.querySelector('#range-summary').textContent=sel?`${date(range.day)} · ${sel.start}–${sel.end} · ${sel.minutes} minut · jedna wizyta`:'Zakres obejmuje zajętą godzinę. Wybierz inne godziny.';
  modal.querySelector('#range-next').disabled=!sel;
  modal.querySelector('#range-start').value=sel?sel.first:'';modal.querySelector('#range-end').value=sel?sel.last:'';
 };
 grid.addEventListener('pointerdown',e=>{const b=e.target.closest('[data-cell]');if(!b||b.disabled)return;e.preventDefault();start=Number(b.dataset.cell);dragging=true;grid.setPointerCapture(e.pointerId);paint(start,start);});
 grid.addEventListener('pointermove',e=>{if(!dragging)return;const b=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-cell]');if(b)paint(start,Number(b.dataset.cell));});
 grid.addEventListener('pointerup',()=>{dragging=false;});grid.addEventListener('pointercancel',()=>{dragging=false;});
 grid.addEventListener('click',e=>{if(e.detail===0){const b=e.target.closest('[data-cell]');if(b)paint(Number(b.dataset.cell),Number(b.dataset.cell));}});
 modal.querySelector('#range-day').onchange=e=>{if(e.target.value)openRange(e.target.value,patient);};
 const selectRange=()=>{const a=modal.querySelector('#range-start').value,b=modal.querySelector('#range-end').value;if(a!==''&&b!=='')paint(Number(a),Number(b));};
 modal.querySelector('#range-start').onchange=selectRange;modal.querySelector('#range-end').onchange=selectRange;
 modal.querySelector('#range-next').onclick=bookingForm;
}
function bookingForm(){
 const sel=selection(range.first,range.last,blockedCells(range.day,state.appointments));if(!sel)return toast('Wybierz dostępny zakres.');
 if(!state.patients.length){modal.close();return patientForm();}
 showModal('Nowa wizyta',`<form id="booking-form" class="padded form-grid" data-id="${crypto.randomUUID()}"><div class="notice full-span">${date(range.day)} · <b>${sel.start}–${sel.end}</b> · ${sel.minutes} minut</div><label class="full-span">Pacjent<select name="patient_id" required><option value="">Wybierz pacjenta</option>${state.patients.map(p=>`<option value="${p.id}" ${p.id===range.patient?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><button type="button" class="text-button full-span" data-book-new-patient>+ Utwórz kartę nowego pacjenta</button><label class="full-span">Zabieg<select name="service_id" required>${state.services.filter(s=>s.active!==false).map(s=>`<option value="${s.id}">${esc(s.name)} · ${s.minutes} min · ${money(s.price)}</option>`).join('')}</select></label><div class="soft-note full-span">Czas wizyty jest zgodny z Twoim zaznaczeniem. Sprawdź, czy wystarczy na wybrany zabieg. Zapis potwierdza wizytę i zleca wiadomość na e-mail z karty pacjenta.</div>${textarea('Notatka organizacyjna (bez danych o zdrowiu)','note')}${formButtons('Zarezerwuj wizytę')}</form>`);
 if(range.patient){const p=state.patients.find(p=>p.id===range.patient),select=modal.querySelector('[name="patient_id"]');if(p&&select){select.closest('label').hidden=true;modal.querySelector('[data-book-new-patient]').hidden=true;modal.querySelector('#booking-form .notice').insertAdjacentHTML('afterend',`<div class="booking-known-patient full-span"><span class="avatar small">${esc(ui.initials(p.name))}</span><div><small>PACJENT</small><b>${esc(p.name)}</b></div></div>`);}}
 if(state.clinic_profile){
  const service=modal.querySelector('[name="service_id"]');
  for(const opt of service.options){const s=state.services.find(s=>s.id===opt.value);opt.textContent=`${s.name} · ${s.minutes} min · ${priceLabel(s)}`;}
  service.closest('label').insertAdjacentHTML('afterend',`${input('Uzgodniona kwota wizyty (PLN)','price',state.services.find(s=>s.id===service.value).price/100,'type="number" min="0" max="100000" step="0.01" required')}<p class="fineprint">Kwota robocza z cennika. Przy widełkach wybierz uzgodnioną kwotę; nie doliczamy dodatków samodzielnie.</p><label class="full-span" id="booking-case-field" hidden>Terapia / problem<select name="case_id"><option value="">Bez przypisania</option></select></label><div class="booking-area-summary full-span"><button type="button" class="outline" id="booking-area-open">+ Dodaj obszar na stopie</button><span id="booking-area-label">Opcjonalnie · możesz przejść dalej</span></div><section class="booking-area-picker full-span" id="booking-area-picker" hidden><div><span class="eyebrow">OBSZAR WIZYTY</span><h3>Dotknij jednego miejsca</h3><p>Po wyborze mapa sama się zamknie.</p></div>${ui.footMap([],true)}<button type="button" class="text-button" id="booking-area-skip">Pomiń obszar</button></section><div class="notice full-span" id="booking-recipient"></div>`);
  const patientSelect=modal.querySelector('[name="patient_id"]'),caseField=modal.querySelector('#booking-case-field'),caseSelect=caseField.querySelector('select');
  const updateContext=()=>{const p=state.patients.find(p=>p.id===patientSelect.value),c=p&&contactFor(p),cases=(state.cases||[]).filter(x=>x.patient_id===p?.id&&x.status==='active').sort((a,b)=>b.created_at.localeCompare(a.created_at));modal.querySelector('#booking-recipient').textContent=c?`Odbiorca powiadomienia: ${c.kind} · ${c.name}${c.email?' · '+c.email:' · brak e-maila (brak wysyłki)'}.${demo?' Demo niczego nie wysyła.':!state.notifications_configured?' Wysyłka jest wyłączona lub nieskonfigurowana.':''}`:'Wybierz pacjenta, aby sprawdzić odbiorcę.';caseSelect.innerHTML='<option value="">Bez przypisania</option>'+cases.map(x=>`<option value="${esc(x.id)}">${esc(x.title)} · ${esc(x.location)}</option>`).join('');if(cases.length===1)caseSelect.value=cases[0].id;caseField.hidden=cases.length<2;};
  patientSelect.onchange=updateContext;updateContext();
  service.onchange=()=>{modal.querySelector('[name="price"]').value=state.services.find(s=>s.id===service.value).price/100;};
  const areaPicker=modal.querySelector('#booking-area-picker'),areaLabel=modal.querySelector('#booking-area-label'),areaButton=modal.querySelector('#booking-area-open'),areaChecks=wireFootMap(areaPicker,{single:true,onSelect:value=>{if(!value)return;areaLabel.textContent=value.replace(':',' · ');areaButton.textContent='Zmień obszar';areaPicker.hidden=true;}});
  areaButton.onclick=()=>{areaPicker.hidden=false;areaPicker.scrollIntoView({behavior:'smooth',block:'center'});};
  modal.querySelector('#booking-area-skip').onclick=()=>{areaChecks.forEach(c=>c.checked=false);areaLabel.textContent='Bez wskazanego obszaru';areaButton.textContent='+ Dodaj obszar na stopie';areaPicker.hidden=true;};
 }
}
function patientForm(id='',returnBooking=false){
 const p=state.patients.find(p=>p.id===id)||{name:'',profile:{}},v=p.profile||{};
 const under18=birth=>{if(!birth)return false;const [y,m,d]=dayKey().split('-').map(Number),[by,bm,bd]=birth.split('-').map(Number);return y-by-((m<bm||m===bm&&d<bd)?1:0)<18;};
 const initialKind=v.patient_kind==='child'||under18(p.birth_date)?'child':'adult';
 const initialTarget=initialKind==='child'||v.contact_target==='guardian'?'guardian':'patient';
 const riskSelect=(key,title)=>`<label>${title}<select name="${key}">${Object.entries(TRI).map(([value,label])=>`<option value="${value}" ${(v[key]||'unknown')===value?'selected':''}>${label}</option>`).join('')}</select></label>`;
 const step=(key,title,lead,body,extra='')=>`<section class="patient-wizard-step full-span ${extra}" data-wizard-step="${key}"><span class="eyebrow">KARTA PACJENTA</span><h3>${title}</h3><p>${lead}</p><div class="patient-step-fields">${body}</div></section>`;
 showModal(id?'Uzupełnij kartę pacjenta':'Nowy pacjent',`<form id="patient-form" data-id="${id||crypto.randomUUID()}" data-return="${returnBooking}" class="padded patient-wizard">
  <input type="hidden" name="patient_kind" value="${initialKind}"><input type="hidden" name="contact_target" value="${initialTarget}"><input type="hidden" name="interview_date" value="${esc(v.interview_date||dayKey())}">
  <div class="patient-wizard-progress full-span"><div><span id="patient-step-count">Krok 1</span><small id="patient-step-title"></small></div><div class="patient-progress-track"><i id="patient-progress-bar"></i></div><p>Widzisz tylko jeden krótki etap. Puste informacje możesz uzupełnić później.</p></div>
  ${step('kind','Kogo dodajesz?','Wybierz rodzaj karty. To pozwoli pokazać tylko potrzebne pytania.',`<div class="patient-kind-choices"><button type="button" class="patient-kind ${initialKind==='adult'?'selected':''}" data-patient-kind="adult"><b>Dorosły</b><small>Kontakt bezpośrednio z pacjentem</small></button><button type="button" class="patient-kind ${initialKind==='child'?'selected':''}" data-patient-kind="child"><b>Mały pacjent</b><small>Kontakt i zgody przez opiekuna</small></button></div>`)}
  ${step('identity','Podstawowe dane','To jedyne informacje potrzebne do założenia karty.',`${input('Imię i nazwisko','name',p.name,'required maxlength="200" autocomplete="off" autofocus')}${input('Data urodzenia — opcjonalnie','birth_date',p.birth_date,'type="date" max="'+dayKey()+'"')}`)}
  ${step('contact','Kontakt','Możesz zostawić puste i wrócić do tego później.',`${input('Telefon — opcjonalnie','phone',p.phone,'type="tel" maxlength="40" autocomplete="tel"')}${input('E-mail — opcjonalnie','email',p.email,'type="email" maxlength="254" autocomplete="email"')}<label class="check-label patient-other-contact"><input type="checkbox" id="patient-other-contact" ${initialTarget==='guardian'&&initialKind!=='child'?'checked':''}> Powiadomienia kieruj do opiekuna lub innej osoby kontaktowej</label>`)}
  ${step('guardian-person','Opiekun / osoba kontaktowa','Te dane są wymagane przy małym pacjencie.',`${input('Imię i nazwisko opiekuna','guardian_name',v.guardian_name,'maxlength="200" autocomplete="off"')}${input('Relacja z pacjentem, np. mama','guardian_relation',v.guardian_relation,'maxlength="200"')}`,'guardian-only')}
  ${step('guardian-contact','Kontakt do opiekuna','Wystarczy telefon albo e-mail.',`${input('Telefon opiekuna','guardian_phone',v.guardian_phone,'type="tel" maxlength="40" autocomplete="tel"')}${input('E-mail opiekuna','guardian_email',v.guardian_email,'type="email" maxlength="254" autocomplete="email"')}`,'guardian-only')}
  ${step('risks-one','Najważniejsze informacje zdrowotne','Jeśli czegoś nie wiesz, pozostaw „Nie ustalono”.',`${riskSelect('diabetes',RISKS.diabetes)}${riskSelect('circulation',RISKS.circulation)}${riskSelect('neuropathy',RISKS.neuropathy)}`)}
  ${step('risks-two','Leki i gojenie','Nie musisz uzupełniać tego podczas zakładania karty.',`${riskSelect('anticoagulants',RISKS.anticoagulants)}${riskSelect('healing',RISKS.healing)}`)}
  ${step('medical-notes','Alergie i ważne informacje','Zapisz tylko to, co pacjent zgłosił i co jest potrzebne.',`${textarea('Alergie — opcjonalnie','allergies',v.allergies)}${textarea('Leki, choroby, operacje i gojenie — opcjonalnie','medications',v.medications)}`)}
  ${step('complaints','Cel wizyty','Jedno krótkie zdanie wystarczy.',`${textarea('Dolegliwości i cel wizyty — opcjonalnie','complaints',v.complaints)}`)}
  ${step('daily','Codzienne obciążenie stóp','Ten etap możesz przejść bez wpisywania.',`${textarea('Obuwie, wkładki i pielęgnacja domowa — opcjonalnie','footwear',v.footwear)}${textarea('Praca, aktywność i obciążenie stóp — opcjonalnie','workload',v.workload)}`)}
  ${step('comfort','Komfort pacjenta','Dobrowolne informacje, które naprawdę pomagają podczas wizyty.',`${textarea('Komfort i samopoczucie — opcjonalnie','wellbeing',v.wellbeing)}${textarea('Warto pamiętać w rozmowie — opcjonalnie','relationship',v.relationship)}<label class="guardian-only">Co pomaga dziecku poczuć się bezpiecznie? — opcjonalnie<textarea name="child_comfort" maxlength="1500">${esc(v.child_comfort||'')}</textarea></label>`)}
  ${step('summary','Gotowe','Sprawdź podstawowe dane. Resztę wywiadu zawsze można uzupełnić w karcie pacjenta.',`<div class="patient-summary" id="patient-summary"></div><div class="soft-note">Niewypełnione pola pozostaną oznaczone jako „Nie ustalono”. Nie powstają żadne dodatkowe rekordy ani puste formularze.</div>`)}
  <div class="patient-wizard-actions full-span"><button type="button" class="text-button" data-close>Anuluj</button><button type="button" class="outline" id="patient-step-back">Wstecz</button><button type="button" class="text-button" id="patient-save-now">Zapisz kartę teraz</button><button type="button" class="primary" id="patient-step-next">Dalej</button><button type="submit" class="primary" id="patient-step-submit">Zapisz kartę</button></div><p class="form-error full-span" role="alert"></p>
 </form>`,true);
 const form=modal.querySelector('#patient-form'),kind=form.elements.patient_kind,target=form.elements.contact_target,birth=form.elements.birth_date,other=form.querySelector('#patient-other-contact');let current=0;
 const guardianNeeded=()=>kind.value==='child'||target.value==='guardian';
 const steps=()=>[...form.querySelectorAll('[data-wizard-step]')].filter(s=>!s.classList.contains('guardian-only')||guardianNeeded());
 const syncKind=()=>{
  if(under18(birth.value))kind.value='child';
  form.querySelectorAll('[data-patient-kind]').forEach(b=>b.classList.toggle('selected',b.dataset.patientKind===kind.value));
  other.disabled=kind.value==='child';if(kind.value==='child')other.checked=true;
  target.value=kind.value==='child'||other.checked?'guardian':'patient';
  form.querySelectorAll('.guardian-only input,.guardian-only textarea').forEach(el=>{if(['guardian_name','guardian_relation'].includes(el.name))el.required=guardianNeeded();});
  const visible=steps();if(current>=visible.length)current=visible.length-1;
 };
 const guardianContactValid=()=>!guardianNeeded()||!!(form.elements.guardian_phone.value.trim()||form.elements.guardian_email.value.trim());
 const requiredReady=()=>form.elements.name.value.trim()&&(!guardianNeeded()||(form.elements.guardian_name.value.trim()&&form.elements.guardian_relation.value.trim()&&guardianContactValid()));
 const validateStep=s=>{
  for(const el of s.querySelectorAll('input,select,textarea'))if(!el.checkValidity()){el.reportValidity();return false;}
  if(s.dataset.wizardStep==='guardian-contact'&&!guardianContactValid()){form.elements.guardian_phone.setCustomValidity('Podaj telefon lub e-mail opiekuna.');form.elements.guardian_phone.reportValidity();return false;}
  form.elements.guardian_phone.setCustomValidity('');return true;
 };
 const updateSummary=()=>{const name=form.elements.name.value.trim()||'Bez imienia',contact=[form.elements.phone.value,form.elements.email.value].filter(Boolean).join(' · ')||'kontakt do uzupełnienia';form.querySelector('#patient-summary').innerHTML=`<b>${esc(name)}</b><span>${kind.value==='child'?'Mały pacjent':'Osoba dorosła'}</span><span>${esc(contact)}</span>${guardianNeeded()?`<span>Opiekun: ${esc(form.elements.guardian_name.value||'do uzupełnienia')}</span>`:''}`;};
 const showStep=()=>{syncKind();const visible=steps();form.querySelectorAll('[data-wizard-step]').forEach(s=>s.classList.remove('active'));visible[current].classList.add('active');const s=visible[current],last=current===visible.length-1;form.querySelector('#patient-step-count').textContent=`Krok ${current+1} z ${visible.length}`;form.querySelector('#patient-step-title').textContent=s.querySelector('h3').textContent;form.querySelector('#patient-progress-bar').style.width=`${(current+1)/visible.length*100}%`;form.querySelector('#patient-step-back').hidden=current===0;form.querySelector('#patient-step-next').hidden=last;form.querySelector('#patient-step-submit').hidden=!last;form.querySelector('#patient-save-now').hidden=last||!requiredReady()||current<2;if(last)updateSummary();modal.scrollTo({top:0,behavior:'smooth'});setTimeout(()=>s.querySelector('input:not([type="hidden"]),select,textarea,button')?.focus(),80);};
 form.querySelectorAll('[data-patient-kind]').forEach(b=>b.onclick=()=>{kind.value=b.dataset.patientKind;if(kind.value==='adult')other.checked=initialTarget==='guardian';syncKind();showStep();});
 birth.onchange=()=>{syncKind();showStep();};other.onchange=()=>{target.value=other.checked?'guardian':'patient';syncKind();showStep();};
 form.addEventListener('input',()=>{form.querySelector('#patient-save-now').hidden=!requiredReady()||current<2;form.elements.guardian_phone.setCustomValidity('');});
 form.querySelector('#patient-step-next').onclick=()=>{const visible=steps(),s=visible[current];if(!validateStep(s))return;current=Math.min(current+1,visible.length-1);showStep();};
 form.querySelector('#patient-step-back').onclick=()=>{current=Math.max(0,current-1);showStep();};
 form.querySelector('#patient-save-now').onclick=()=>form.requestSubmit();
 showStep();
}
function encounterForm(patientId,appointmentId='',amendsId='',caseId=''){
 const p=state.patients.find(p=>p.id===patientId),a=state.appointments.find(a=>a.id===appointmentId);if(!p)return;
 showModal(amendsId?'Uzupełnienie dokumentacji':'Dokumentacja wizyty',`<form id="encounter-form" data-id="${crypto.randomUUID()}" data-patient="${patientId}" data-appointment="${appointmentId}" data-amends="${amendsId}" class="padded form-grid"><div class="notice full-span"><b>${esc(p.name)}</b> · ${date(new Date())}<br>${amendsId?'Powstanie nowy wpis powiązany z oryginałem. Oryginalna dokumentacja pozostanie bez zmian.':'Po zapisaniu wpisu nie można go nadpisać. Błędy wyjaśnij uzupełnieniem.'}</div><h3 class="full-span">Lokalizacja obserwacji</h3><div class="full-span">${ui.footMap(a?.zones||[],true)}</div>${textarea('Obserwacje i zgłaszane dolegliwości','observations',a?.live_notes||'','required')}${textarea('Wykonane czynności / przebieg zabiegu','performed',amendsId?'Uzupełnienie wpisu: ':'','required')}${textarea('Zastosowane materiały, opatrunki, preparaty, klamry (opcjonalnie seria)','products')}${textarea('Zalecenia przekazane pacjentowi i ustalenia','aftercare','','required')}<label>Ból zgłaszany przez pacjenta<select name="pain"><option value="">Nie oceniono</option>${Array.from({length:11},(_,i)=>`<option value="${i}">${i} / 10</option>`).join('')}</select></label>${input('Planowana kontrola (opcjonalnie)','followup_date','','type="date" min="'+dayKey()+'"')}${!amendsId?input('Kwota wizyty (PLN)','amount',(a?.price||0)/100,'type="number" min="0" max="100000" step="0.01" required')+'<label class="check-label"><input type="checkbox" name="paid"> Wizyta opłacona</label>':''}<div class="safety-note full-span">Rana, podejrzenie zakażenia lub nagły obrzęk / zmiana koloru, szczególnie przy cukrzycy, wymagają odpowiedniej oceny medycznej. Ta karta nie kwalifikuje automatycznie do zabiegu. <a href="https://www.nice.org.uk/guidance/ng19/chapter/Recommendations" target="_blank" rel="noreferrer">Wytyczne NICE ↗</a></div>${formButtons('Zapisz dokumentację')}</form>`,true);
 wireFootMap(modal.querySelector('#encounter-form'));
 if(state.clinic_profile){
  const original=state.encounters.find(v=>v.id===amendsId),chosen=original?.case_id||caseId||a?.case_id;
  modal.querySelector('#encounter-form .notice').insertAdjacentHTML('afterend',`<label class="full-span">Problem / terapia<select name="case_id" ${amendsId?'disabled':''}>${clinic.caseOptions(state,patientId,chosen)}</select></label>`);
  if(amendsId)modal.querySelector('#encounter-form').dataset.case=chosen||'';
 }
}
function caseForm(pid){
 showModal('Nowy problem / terapia',`<form id="case-form" data-id="${crypto.randomUUID()}" data-patient="${pid}" class="padded form-grid">${input('Nazwa problemu, np. kontrole klamry','title','','required maxlength="150"')}<label>Miejsce na stopie<select name="location" required><option value="">Wybierz lokalizację</option>${clinic.locations.map(l=>`<option>${esc(l)}</option>`).join('')}</select></label>${textarea('Cel opieki / plan do kolejnej kontroli','goal')}<p class="fineprint full-span">Każdy niezależny problem ma własną historię. Nazwa służy organizacji dokumentacji, nie jest automatyczną diagnozą.</p>${formButtons('Dodaj problem')}</form>`);
}
function rescheduleForm(id){
 const a=state.appointments.find(a=>a.id===id);if(!a)return;
 const starts=Array.from({length:24},(_,i)=>clock(480+i*30)),ends=Array.from({length:24},(_,i)=>clock(510+i*30));
 showModal('Zmień godzinę wizyty',`<form id="reschedule-form" data-id="${a.id}" class="padded form-grid"><div class="booking-known-patient full-span"><span class="avatar small">${esc(ui.initials(a.patient_name))}</span><div><small>PACJENT</small><b>${esc(a.patient_name)}</b><span>${esc(a.service_name)}</span></div></div>${input('Dzień','day',dayKey(a.starts_at),'type="date" min="'+dayKey()+'" required')}<label>Od<select name="start" required>${starts.map(v=>`<option ${v===time(a.starts_at)?'selected':''}>${v}</option>`).join('')}</select></label><label>Do<select name="end" required>${ends.map(v=>`<option ${v===time(a.ends_at)?'selected':''}>${v}</option>`).join('')}</select></label><div class="soft-note full-span">Aplikacja sprawdzi kolizję z innymi wizytami. Historia pacjenta, problem i zdjęcia pozostaną bez zmian.</div>${formButtons('Zapisz nową godzinę')}</form>`);
}
function appointmentModal(id){
 const a=state.appointments.find(a=>a.id===id);if(!a)return;
 const c=(state.cases||[]).find(c=>c.id===a.case_id),area=a.zones?.[0];
 showModal('Szczegóły wizyty',`<div class="padded"><span class="tag ${a.status}">${{confirmed:'Potwierdzona',completed:'Zakończona',cancelled:'Anulowana'}[a.status]}</span><h2>${esc(a.patient_name)}</h2><h3>${date(a.starts_at)} · ${time(a.starts_at)}–${time(a.ends_at)}</h3><p>${esc(a.service_name)} · ${money(a.price)}</p>${c||area?`<p class="notice">${c?esc(c.title)+' · '+esc(c.location):esc(area.replace(':',' · '))}</p>`:''}<p class="muted">Gabinet: ${esc(a.clinic_address||'Uzupełnij adres w ustawieniach')}</p><p>${esc(a.note)}</p><div class="stack"><button class="outline" data-open-patient="${a.patient_id}">Otwórz kartę pacjenta →</button>${a.status==='confirmed'?`<button class="primary" data-open-active="${a.id}">Otwórz aktywną wizytę</button><button class="outline" data-active-reschedule="${a.id}">Zmień godzinę wizyty</button><button class="danger" data-cancel-appointment="${a.id}">Anuluj wizytę i zwolnij termin</button>`:''}</div><p class="fineprint">Anulowanie zachowuje historię rezerwacji. Zwalnia godziny i odwołuje oczekujące przypomnienia. Wysłanego e-maila nie można cofnąć.</p></div>`);
}
function serviceForm(id){const s=state.services.find(s=>s.id===id)||{name:'',category:'',minutes:30,price:0};showModal('Zabieg podologiczny',`<form id="service-form" data-service="${id||crypto.randomUUID()}" class="padded form-grid">${input('Nazwa','name',s.name,'required maxlength="200"')}${input('Kategoria','category',s.category,'required maxlength="100"')}${input('Czas (minuty, co 30)','minutes',s.minutes,'type="number" min="30" max="720" step="30" required')}${input(state.clinic_profile?'Cena minimalna / stała (PLN)':'Cena (PLN)','price',s.price/100,'type="number" min="0" max="100000" step="0.01" required')}${state.clinic_profile?`<label>Rodzaj ceny<select name="price_kind"><option value="fixed" ${s.price_max===s.price||s.price_max===undefined?'selected':''}>Stała</option><option value="range" ${s.price_max>s.price?'selected':''}>Widełki</option><option value="from" ${s.price_max===null?'selected':''}>Cena od</option></select></label>${input('Cena maksymalna (dla widełek)','price_max',(s.price_max??s.price)/100,'type="number" min="0" max="100000" step="0.01"')}${textarea('Uwagi do ceny / wariantu','price_note',s.price_note)}<label class="check-label full-span"><input name="time_confirmed" type="checkbox" ${s.time_confirmed?'checked':''}> Czas zabiegu potwierdzony przez gabinet</label>`:''}<div class="soft-note full-span">Zmiana cennika nie zmienia cen już zapisanych rezerwacji.</div>${formButtons('Zapisz zabieg')}</form>`);}
async function run(fn,form){
 if(busy)return;busy=true;document.body.classList.add('busy');
 const buttons=Array.from(document.querySelectorAll('button[type="submit"]'));buttons.forEach(b=>b.disabled=true);
 try{await fn();}catch(e){const err=form?.querySelector('.form-error');if(err)err.textContent=e.message;toast(e.message);}finally{busy=false;document.body.classList.remove('busy');buttons.forEach(b=>b.disabled=false);}
}
document.addEventListener('submit',event=>{
 const f=event.target;if(!(f instanceof HTMLFormElement))return;event.preventDefault();const d=Object.fromEntries(new FormData(f));
 run(async()=>{
  let action,data,message;
  if(f.id==='login-form'){
   const r=await fetch(`${config.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:JSON.stringify({email:d.email,password:d.password})});
   if(!r.ok)throw Error('Nie udało się zalogować. Sprawdź login, hasło i uprawnienia.');
   session={...await r.json(),expires_at:Date.now()+3600000};state=await api();return render();
  }
  if(f.id==='active-visit-find'){
   const clean=v=>String(v||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),wanted=clean(d.surname);
   const today=state.appointments.filter(a=>a.status==='confirmed'&&dayKey(a.starts_at)===dayKey()),matches=today.filter(a=>clean(state.patients.find(p=>p.id===a.patient_id)?.name.split(/\s+/).at(-1))===wanted);
   if(matches.length===1){activeAppointmentId=matches[0].id;activeShowChoices=false;}else{activeAppointmentId='';activeShowChoices=true;toast(matches.length?'Wybierz właściwą wizytę z listy.':'Nie znaleziono tego nazwiska. Wybierz pacjenta z listy lub dodaj nowego.');}render();return;
  }
  if(f.id==='patient-form'){
   const {name,email,phone,birth_date,...profile}=d;action='patient';data={id:f.dataset.id,name,email,phone,birth_date:birth_date||null,profile};validatePatient(data);message='Zapisano kartę pacjenta.';
  }else if(f.id==='booking-form'){
   const sel=selection(range.first,range.last,blockedCells(range.day,state.appointments));if(!sel)throw Error('Zakres przestał być dostępny. Wybierz go ponownie.');
   action='book';data={...d,id:f.dataset.id,...validateRange(range.day,sel.start,sel.end),...(state.clinic_profile?{price:Math.round(Number(d.price)*100),case_id:d.case_id||'',zones:d.zones?[d.zones]:[]}:{})};message=demo?'Zapisano wizytę w demo. Nie wysłano e-maila.':'Zapisano wizytę. Status e-maila sprawdzisz w Ustawieniach.';
  }else if(f.id==='reschedule-form'){
   action='reschedule';data={id:f.dataset.id,...validateRange(d.day,d.start,d.end)};message='Zmieniono godzinę wizyty.';
  }else if(f.id==='active-note-form'){
   action='visit-note';data={id:f.dataset.appointment,live_notes:String(d.live_notes||'')};message='Zapisano spostrzeżenia z wizyty.';
  }else if(f.id==='encounter-form'){
   action='encounter';data={...d,id:f.dataset.id,patient_id:f.dataset.patient,appointment_id:f.dataset.appointment||null,amends_id:f.dataset.amends||null,zones:new FormData(f).getAll('zones'),pain:d.pain===''?null:Number(d.pain),amount:Math.round(Number(d.amount||0)*100),paid:d.paid==='on',followup_date:d.followup_date||null};validateEncounter(data);message='Dokumentacja została zapisana.';
   if(state.clinic_profile)data.case_id=f.dataset.amends?(f.dataset.case||''):(d.case_id||'');
  }else if(f.id==='case-form'){action='case';data={...d,id:f.dataset.id,patient_id:f.dataset.patient};message=demo?'Dodano problem w demo.':'Dodano problem w karcie pacjenta.';
  }else if(f.id==='service-form'){action='service';data={...d,service_id:f.dataset.service,price:Math.round(Number(d.price)*100),minutes:Number(d.minutes)};
   if(state.clinic_profile){data.price_max=d.price_kind==='from'?null:d.price_kind==='range'?Math.round(Number(d.price_max)*100):data.price;data.time_confirmed=d.time_confirmed==='on';if(data.price_max!==null&&data.price_max<data.price)throw Error('Cena maksymalna nie może być niższa od minimalnej.');}
   message='Zapisano zabieg.';
  }else if(f.id==='settings-form'){action='settings';data={...d,reminders:d.reminders==='on'};message='Zapisano ustawienia.';}else return;
  await api(action,data);await refresh();modal.close();toast(message);
  if(f.id==='patient-form'&&f.dataset.return==='true'){range.patient=data.id;bookingForm();}
  if(f.id==='encounter-form'){patientTab='history';location.hash='patient/'+data.patient_id+'?tab=history';render();}
  if(f.id==='case-form'){caseFilter=data.id;patientTab='cases';render();}
 },f);
});
document.addEventListener('click',event=>{
 const b=event.target.closest('button,[data-prompt]');if(!b)return;
 if(b.hasAttribute('data-close'))return modal.close();
 if(b.hasAttribute('data-logout')){session=null;state=null;pendingPhoto=null;for(const x of photoUrls.values())if(x.url?.startsWith('blob:'))URL.revokeObjectURL(x.url);photoUrls.clear();modal.close();if(demo)location.href=location.pathname;else showLogin();return;}
 if(b.hasAttribute('data-book'))return openRange(b.dataset.book||selected);
 if(b.dataset.bookPatient)return openRange(selected,b.dataset.bookPatient);
 if(b.dataset.day){selected=b.dataset.day;render();return;}
 if(b.dataset.month){const d=new Date(month+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+Number(b.dataset.month));month=d.toISOString().slice(0,7);render();return;}
 if(b.hasAttribute('data-today')){selected=dayKey();month=selected.slice(0,7);render();return;}
 if(b.hasAttribute('data-active-show')){activeShowChoices=true;render();return;}
 if(b.hasAttribute('data-active-reset')){activeAppointmentId='';activeShowChoices=true;render();return;}
 if(b.hasAttribute('data-active-new-patient'))return patientForm();
 if(b.dataset.activeAppointment){activeAppointmentId=b.dataset.activeAppointment;activeShowChoices=false;render();return;}
 if(b.dataset.openActive){activeAppointmentId=b.dataset.openActive;activeShowChoices=false;modal.close();location.hash='active';render();return;}
 if(b.dataset.activeReschedule)return rescheduleForm(b.dataset.activeReschedule);
 if(b.dataset.appointment)return appointmentModal(b.dataset.appointment);
 if(b.dataset.openPatient){modal.close();patientTab='overview';location.hash='patient/'+b.dataset.openPatient;return;}
 if(b.dataset.documentAppointment){const a=state.appointments.find(a=>a.id===b.dataset.documentAppointment);return encounterForm(a.patient_id,a.id);}
 if(b.dataset.cancelAppointment){const id=b.dataset.cancelAppointment;showModal('Anulować wizytę?',`<div class="padded"><p>Termin wróci do dostępnych godzin. Oczekujące przypomnienia zostaną anulowane. Historia pozostanie w bazie.</p><div class="form-actions"><button class="outline" data-close>Nie, wróć</button><button class="danger" id="confirm-cancel">Tak, anuluj wizytę</button></div></div>`);modal.querySelector('#confirm-cancel').onclick=()=>run(async()=>{await api('cancel',{id});await refresh();modal.close();toast('Anulowano wizytę i zwolniono godziny.');});return;}
 if(b.hasAttribute('data-new-patient'))return patientForm();
 if(b.hasAttribute('data-book-new-patient'))return patientForm('',true);
 if(b.dataset.editPatient)return patientForm(b.dataset.editPatient);
 if(b.dataset.patientTab){patientTab=b.dataset.patientTab;render();return;}
 if(b.dataset.newCase)return caseForm(b.dataset.newCase);
 if(b.dataset.caseEncounter)return encounterForm(b.dataset.patient,'','',b.dataset.caseEncounter);
 if(b.dataset.casePhotos){photoCase=b.dataset.casePhotos;photoEncounter='';patientTab='photos';render();return;}
 if(b.dataset.visitPhotos){photoCase=b.dataset.case;photoEncounter=b.dataset.visitPhotos;patientTab='photos';render();return;}
 if(b.hasAttribute('data-all-visit-photos')){photoEncounter='';render();return;}
 if(b.dataset.caseStatus){const d={id:b.dataset.caseStatus,patient_id:b.dataset.patient,status:b.dataset.status};showModal(d.status==='closed'?'Zakończyć problem?':'Wznowić problem?',`<div class="padded"><p>Zmienisz tylko status. Wpisy wizyt i fotografie pozostaną w historii. Nie zmienia to istniejących rezerwacji.</p><div class="form-actions"><button class="outline" data-close>Wróć</button><button class="primary" id="confirm-case-status">Potwierdź</button></div></div>`);modal.querySelector('#confirm-case-status').onclick=()=>run(async()=>{await api('case-status',d);modal.close();await refresh();toast(demo?'Zmieniono status w demo.':'Zmieniono status problemu.');});return;}
 if(b.dataset.encounter)return encounterForm(b.dataset.encounter);
 if(b.dataset.amend){const v=state.encounters.find(v=>v.id===b.dataset.amend);return encounterForm(v.patient_id,'',v.id);}
 if(b.hasAttribute('data-new-service')||b.dataset.service)return serviceForm(b.dataset.service);
 if(b.hasAttribute('data-refresh'))return run(refresh);
 if(b.hasAttribute('data-retry-photo'))return run(async()=>{modal.close();await uploadPendingPhoto();});
 if(b.hasAttribute('data-cancel-photo')){if(pendingPhoto?.preview_url)URL.revokeObjectURL(pendingPhoto.preview_url);pendingPhoto=null;modal.close();return;}
 if(b.hasAttribute('data-confirm-photo'))return run(async()=>{applyPhotoAssignmentFromModal();modal.close();await uploadPendingPhoto();});
 if(b.dataset.photoView)return run(async()=>{photoUrls.delete(b.dataset.photoView);const url=await getPhotoUrl(b.dataset.photoView);showModal('Zdjęcie w karcie pacjenta',`<div class="photo-detail"><img src="${esc(url)}" alt="Dokumentacja stopy"><p>Prywatna dokumentacja pacjenta</p></div>`,true);});
 if(b.hasAttribute('data-compare-open'))return run(async()=>{
  const ids=Array.from(document.querySelectorAll('[data-compare-photo]:checked')).map(x=>x.dataset.comparePhoto),pid=route().split('/')[1]?.split('?')[0];
  if(ids.length!==2)throw Error('Zaznacz dokładnie dwa zdjęcia do porównania.');
  const photos=ids.map(id=>state.photos.find(p=>p.id===id&&p.patient_id===pid));
  if(photos.some(p=>!p)||!photos[0].case_id||photos[0].case_id!==photos[1].case_id)throw Error('Wybierz dwa zdjęcia przypisane do tego samego problemu.');
  photos.sort((a,b)=>(a.taken_on||a.created_at).localeCompare(b.taken_on||b.created_at));
  const urls=await Promise.all(photos.map(p=>getPhotoUrl(p.id)));showModal('Porównanie dokumentacji',clinic.compareMarkup(photos,urls,state),true);
 });
 if(b.hasAttribute('data-install')){if(installPrompt){installPrompt.prompt();installPrompt=null;}else toast('Otwórz aplikację pod adresem HTTPS. W menu przeglądarki wybierz „Zainstaluj” lub „Dodaj do ekranu początkowego”.');}
});
document.addEventListener('input',e=>{if(e.target.id==='patient-search'){search=e.target.value;const caret=e.target.selectionStart;document.querySelector('#content').innerHTML=ui.patients(state,search);const input=document.querySelector('#patient-search');input.focus();input.setSelectionRange(caret,caret);}});
document.addEventListener('change',e=>{
 if(e.target.id==='case-filter'){caseFilter=e.target.value;render();}
});
function photoInputContext(input){const section=input.closest('[data-photo-patient]'),patientId=input.dataset.photoInput;return state.clinic_profile?suggestPhotoContext(state,patientId,new Date(),{case_id:section?.dataset.photoFilterCase||'',encounter_id:section?.dataset.photoFilterEncounter||''}):{};}
function photoVisitOptions(pid,context){
 const now=new Date(),appointments=(state.appointments||[]).filter(a=>a.patient_id===pid&&a.status!=='cancelled'&&new Date(a.starts_at)<=now).sort((a,b)=>b.starts_at.localeCompare(a.starts_at));
 const linked=new Set(appointments.map(a=>a.id)),encounters=(state.encounters||[]).filter(v=>v.patient_id===pid&&(!v.appointment_id||!linked.has(v.appointment_id))).sort((a,b)=>b.created_at.localeCompare(a.created_at));
 return `<option value="">Tylko karta pacjenta</option>${appointments.map(a=>`<option value="a:${esc(a.id)}" ${a.id===context.appointment_id?'selected':''}>${date(a.starts_at)} · ${time(a.starts_at)}–${time(a.ends_at)} · ${esc(a.service_name)}</option>`).join('')}${encounters.map(v=>`<option value="e:${esc(v.id)}" ${!context.appointment_id&&v.id===context.encounter_id?'selected':''}>${date(v.created_at)} · ${time(v.created_at)} · dokumentacja wizyty</option>`).join('')}`;
}
function contextForPhotoVisit(pid,value,currentCase=''){
 const [kind,id]=String(value||'').split(':');
 if(kind==='a'){const a=state.appointments.find(a=>a.id===id&&a.patient_id===pid),v=state.encounters.find(v=>v.appointment_id===id&&v.patient_id===pid);if(!a)return suggestPhotoContext(state,pid);return {patient_id:pid,appointment_id:a.id,encounter_id:v?.id||'',case_id:a.case_id||v?.case_id||currentCase||'',phase:'control',taken_on:dayKey(a.starts_at)};}
 if(kind==='e'){const v=state.encounters.find(v=>v.id===id&&v.patient_id===pid);if(!v)return suggestPhotoContext(state,pid);return {patient_id:pid,appointment_id:v.appointment_id||'',encounter_id:v.id,case_id:v.case_id||currentCase||'',phase:'control',taken_on:dayKey(v.created_at)};}
 return {patient_id:pid,appointment_id:'',encounter_id:'',case_id:currentCase||'',phase:'control',taken_on:dayKey()};
}
function showPhotoConfirmation(){
 const d=pendingPhoto,p=state.patients.find(p=>p.id===d?.patient_id);if(!d||!p)return;
 d.preview_url=d.preview_url||URL.createObjectURL(d.blob);
 const selected=d.appointment_id?'a:'+d.appointment_id:d.encounter_id?'e:'+d.encounter_id:'';
 showModal('Potwierdź przypisanie zdjęcia',`<div class="padded photo-confirm"><img src="${esc(d.preview_url)}" alt="Podgląd wybranego zdjęcia"><div class="photo-confirm-details"><span class="eyebrow">PACJENT I WIZYTA</span><h3 id="photo-confirm-patient">${esc(p.name)}</h3><p id="photo-confirm-visit"></p><p id="photo-confirm-case"></p></div><details class="photo-advanced full-span"><summary>Zmień przypisanie</summary><div class="form-grid"><label class="full-span">Wizyta<select id="photo-confirm-visit-select">${photoVisitOptions(p.id,d)}</select></label><label>Problem / terapia<select id="photo-confirm-case-select">${clinic.caseOptions(state,p.id,d.case_id,'Bez przypisanego problemu')}</select></label><label>Data zdjęcia<input type="date" id="photo-confirm-date" value="${esc(d.taken_on)}" max="${dayKey()}"></label></div></details><div class="photo-confirm-question full-span">Czy zapisać zdjęcie z tym przypisaniem?</div><div class="form-actions full-span"><button type="button" class="outline" data-cancel-photo>Anuluj</button><button type="button" class="primary" data-confirm-photo>Tak, zapisz zdjęcie</button></div></div>`,true);
 const visitSelect=modal.querySelector('#photo-confirm-visit-select'),caseSelect=modal.querySelector('#photo-confirm-case-select'),dateInput=modal.querySelector('#photo-confirm-date');visitSelect.value=selected;
 const paint=()=>{const context=contextForPhotoVisit(p.id,visitSelect.value,caseSelect.value),a=state.appointments.find(a=>a.id===context.appointment_id),v=state.encounters.find(v=>v.id===context.encounter_id),c=state.cases.find(c=>c.id===caseSelect.value);modal.querySelector('#photo-confirm-visit').innerHTML=a?`<b>${date(a.starts_at)} · ${time(a.starts_at)}–${time(a.ends_at)}</b><br>${esc(a.service_name)}`:v?`<b>${date(v.created_at)} · ${time(v.created_at)}</b><br>Udokumentowana wizyta`:'<b>Bez konkretnej wizyty</b><br>Zdjęcie pozostanie w karcie pacjenta.';modal.querySelector('#photo-confirm-case').innerHTML=c?`Terapia: <b>${esc(c.title)}</b> · ${esc(c.location)}`:'Problem: <b>bez przypisania</b>';};
 visitSelect.onchange=()=>{const context=contextForPhotoVisit(p.id,visitSelect.value,caseSelect.value);caseSelect.value=context.case_id||'';dateInput.value=context.taken_on;paint();};caseSelect.onchange=paint;paint();
}
function applyPhotoAssignmentFromModal(){
 if(!pendingPhoto)throw Error('Brak zdjęcia do zapisania.');const visit=modal.querySelector('#photo-confirm-visit-select'),caseSelect=modal.querySelector('#photo-confirm-case-select'),dateInput=modal.querySelector('#photo-confirm-date');
 const context=contextForPhotoVisit(pendingPhoto.patient_id,visit?.value||'',caseSelect?.value||'');context.case_id=caseSelect?.value||context.case_id||'';context.taken_on=dateInput?.value||context.taken_on;validateLinks(state,pendingPhoto.patient_id,context.case_id,context.encounter_id,context.appointment_id);if(!/^\d{4}-\d{2}-\d{2}$/.test(context.taken_on)||context.taken_on>dayKey())throw Error('Sprawdź datę wykonania zdjęcia.');Object.assign(pendingPhoto,context);
}
document.addEventListener('click',e=>{if(e.target.dataset.photoInput)e.target.photoContext=photoInputContext(e.target);},true);
document.addEventListener('change',e=>{const patientId=e.target.dataset.photoInput;if(!patientId)return;const file=e.target.files?.[0];if(!file)return;const id=crypto.randomUUID();
 // Snapshot wykonany przy otwarciu aparatu; fallback obsługuje także testowe setInputFiles.
 const context=e.target.photoContext||photoInputContext(e.target);delete e.target.photoContext;
 e.target.value='';run(async()=>{if(state.clinic_profile){validateLinks(state,patientId,context.case_id,context.encounter_id,context.appointment_id);if(!/^\d{4}-\d{2}-\d{2}$/.test(context.taken_on)||context.taken_on>dayKey())throw Error('Sprawdź datę wykonania zdjęcia.');}const photo=await compressPhoto(file);pendingPhoto={...photo,id,patient_id:patientId,...context};showPhotoConfirmation();});});
function resetRouteFilters(){const tab=new URLSearchParams(route().split('?')[1]||'').get('tab');patientTab=['cases','photos','history','profile'].includes(tab)?tab:'overview';caseFilter='';photoCase='';photoEncounter='';}
window.addEventListener('hashchange',()=>{resetRouteFilters();render();window.scrollTo(0,0);});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
modal.addEventListener('click',e=>{if(e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close();}});
function showLogin(error=''){
 root.innerHTML=`<main class="login"><section class="login-art"><div class="brand"><img class="clinic-logo" src="assets/podo-profilaktyka-logo.png" alt="Podo-Profilaktyka"></div><h1>Uważna opieka.<br>Dobrze zorganizowany gabinet.</h1><p>Terminarz, karta pacjenta i dokumentacja zabiegów podologicznych w jednym miejscu.</p>${ui.footMap(['L:Przodostopie'])}</section><section class="login-form panel"><span class="eyebrow">STREFA PERSONELU</span><h2>Witaj w swoim gabinecie</h2>${config?.url&&config?.key?`<form id="login-form">${input('E-mail','email','','type="email" autocomplete="username" required')}${input('Hasło','password','','type="password" autocomplete="current-password" required')}<button type="submit" class="primary full">Zaloguj się</button><p class="form-error" role="alert">${esc(error)}</p></form>`:'<p>Ta kopia czeka na podłączenie osobnej bazy Supabase. Możesz już sprawdzić działający podgląd.</p>'}<a class="outline full" href="?demo=1#dashboard">Otwórz demo z fikcyjnymi pacjentami →</a><p class="fineprint">Demo nie służy do przechowywania prawdziwych danych i nie wysyła wiadomości.</p></section></main>`;
}
async function boot(){
 if(demo){state=new URLSearchParams(location.search).get('generic')==='1'?seed():personalizeDemo(seed());resetRouteFilters();render();}else{try{const r=await fetch('/.netlify/functions/podo-api?config=1');config=await r.json();}catch{config={};}showLogin();}
 if('serviceWorker' in navigator&&!demo)navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
}
boot();
