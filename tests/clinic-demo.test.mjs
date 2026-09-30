import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,demoAction} from '../assets/demo.js';
import {personalizeDemo,CLINIC,CLINIC_SERVICES,clinicAction,isMinor,validateClinicPatient,contactFor,validateLinks,priceLabel,suggestPhotoContext} from '../assets/clinic-profile.js';
import {casePanel,guardianCard,clinicServices,clinicPhotoSection,guardianFields} from '../assets/clinic-ui.js';
test('profil gabinetu nie zmienia ogólnego seeda ani backendu',()=>{
 const s=personalizeDemo(seed());assert.equal(s.settings.name,'Podo-Profilaktyka');assert.equal(s.settings.phone,'+48 664 010 384');assert.equal(seed().services.length,9);assert.equal(seed().cases,undefined);assert.equal(s.services.length,37);assert.equal(new Set(s.services.map(s=>s.id)).size,37);
 for(const a of s.appointments)assert.equal(a.clinic_address,CLINIC.address);
});
test('cennik zachowuje widełki, warianty i cenę od',()=>{
 const find=id=>CLINIC_SERVICES.find(s=>s.id===id);
 assert.equal(find('consult').price,7000);assert.equal(find('basic').price,16000);assert.equal(find('brace').price_max,22000);assert.equal(find('onycholysis-two').price,18000);assert.equal(find('tamponade').price_max,null);assert(priceLabel(find('tamponade')).startsWith('od '));assert(priceLabel(find('brace')).includes('–'));
 assert.equal(CLINIC_SERVICES.filter(s=>s.time_confirmed).length,1);
});
test('małoletność bierze pod uwagę datę urodzin, opiekun ma osobne dane',()=>{
 assert(isMinor({birth_date:'2008-09-29'},'2026-09-28'));assert(!isMinor({birth_date:'2008-09-28'},'2026-09-28'));
 assert(isMinor({profile:{patient_kind:'child'}}));assert(!isMinor({birth_date:'1983-05-18',profile:{patient_kind:'child'}}));
 const p=personalizeDemo(seed()).patients.find(p=>p.id==='p4');assert.doesNotThrow(()=>validateClinicPatient(p));assert.equal(contactFor(p).kind,'opiekun');assert.equal(contactFor(p).email,'opiekun@example.invalid');
 p.email='child@example.invalid';assert.equal(contactFor(p).email,'opiekun@example.invalid');p.profile.guardian_name='';assert.throws(()=>validateClinicPatient(p),/opiekuna/);
});
test('brak kontaktu opiekuna nie jest zastępowany kontaktem dziecka',()=>{
 const p=personalizeDemo(seed()).patients.find(p=>p.id==='p4');p.email='child@example.invalid';p.profile.guardian_email='';assert.throws(()=>validateClinicPatient(p),/telefon lub e-mail/);p.profile.guardian_phone='testowy telefon';assert.equal(contactFor(p).email,'');
});
test('powiązania problemu, wizyty i zdjęcia nie przekraczają kart pacjentów',()=>{
 const s=personalizeDemo(seed());assert.doesNotThrow(()=>validateLinks(s,'p2','c2','v2'));assert.throws(()=>validateLinks(s,'p1','c2'));assert.throws(()=>validateLinks(s,'p1','c1','v2'));assert.throws(()=>validateLinks(s,'p2','','v2'));assert.throws(()=>validateLinks(s,'nie-ma'));
});
test('nowy problem jest idempotentny, zamknięcie zachowuje wizyty i zdjęcia',()=>{
 const s=personalizeDemo(seed()),d={id:'c9',patient_id:'p2',title:'Test',location:'Prawa stopa · pięta'};
 clinicAction(s,'case',d);clinicAction(s,'case',d);assert.equal(s.cases.filter(c=>c.id==='c9').length,1);
 const before=JSON.stringify([s.encounters,s.photos]);clinicAction(s,'case-status',{id:'c2',patient_id:'p2',status:'closed'});assert.equal(JSON.stringify([s.encounters,s.photos]),before);assert.equal(s.cases.find(c=>c.id==='c2').status_history.length,1);
 assert.throws(()=>clinicAction(s,'case-status',{id:'c2',patient_id:'p1',status:'closed'}));assert.throws(()=>clinicAction(seed(),'case',d));
});
test('widoki kliniki renderują i escapują dane; galerie filtrowane po pacjencie i wizycie',()=>{
 const s=personalizeDemo(seed());for(const html of [casePanel(s,'p2'),guardianCard(s.patients[3]),guardianFields(s.patients[3]),clinicServices(s),clinicPhotoSection(s,'p2')])assert(html.length>100);
 assert(!clinicPhotoSection(s,'p1').includes('data-photo="demo-before"'));assert(clinicPhotoSection(s,'p2','c2','v2').includes('data-photo="demo-before"'));assert(!clinicPhotoSection(s,'p2','c2','v2').includes('data-photo="demo-control"'));
 s.cases[1].title='<img src=x onerror=alert(1)>';assert(casePanel(s,'p2').includes('&lt;img'));assert(!casePanel(s,'p2').includes('<img src=x'));
});
test('zdjęcie automatycznie wybiera bieżącą wizytę i nie przechodzi do innego pacjenta',()=>{
 const s=personalizeDemo(seed()),now=new Date(s.appointments.find(a=>a.id==='a2').starts_at);now.setMinutes(now.getMinutes()+5);
 const d=suggestPhotoContext(s,'p2',now);assert.equal(d.appointment_id,'a2');assert.equal(d.patient_id,'p2');assert.equal(d.case_id,'c2');
 assert.throws(()=>validateLinks(s,'p1',d.case_id,d.encounter_id,d.appointment_id));
});
