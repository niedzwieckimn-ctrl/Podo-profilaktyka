import test from 'node:test';
import assert from 'node:assert/strict';
import {selection,instant,validateRange,dayKey,time,shiftDay,overlaps,blockedCells,validateEncounter} from '../assets/domain.js';
import {seed,demoAction} from '../assets/demo.js';
import {emailContent} from '../netlify/lib/mail.js';
test('zaznaczenie tworzy jeden zakres, również przeciągany wstecz',()=>{
 assert.deepEqual(selection(3,1),{first:1,last:3,start:'08:30',end:'10:00',minutes:90});assert.equal(selection(0,0).minutes,30);assert.equal(selection(23,23).end,'20:00');assert.equal(selection(24,24),null);
});
test('nie pozwala przeciągnąć przez zajętą godzinę',()=>{assert.equal(selection(0,4,[false,false,true]),null);assert.equal(selection(null,2),null);});
test('czas Warszawy: lato, zima i zmiany czasu',()=>{
 assert.equal(instant('2026-09-06','10:00'),'2026-09-06T08:00:00.000Z');assert.equal(instant('2026-12-06','10:00'),'2026-12-06T09:00:00.000Z');
 for(const day of ['2026-03-29','2026-10-25']){assert.equal(dayKey(instant(day,'08:00')),day);assert.equal(time(instant(day,'08:00')),'08:00');}
 assert.throws(()=>instant('2026-02-31','09:00'));assert.throws(()=>validateRange('2026-09-06','07:30','08:30'));assert.throws(()=>validateRange('2026-09-06','10:00','09:00'));
});
test('rezerwacje są półotwarte: sąsiednie godziny nie kolidują',()=>{const a={...validateRange('2028-01-01','10:00','11:00'),status:'confirmed'};assert.equal(overlaps(a,validateRange('2028-01-01','11:00','12:00')),false);assert.equal(overlaps(a,validateRange('2028-01-01','10:30','11:30')),true);assert.equal(overlaps({...a,status:'cancelled'},a),false);});
test('komórki kalendarza blokują przeszłość i aktywne wizyty',()=>{const a={...validateRange('2028-01-01','10:00','11:00'),status:'confirmed'};const cells=blockedCells('2028-01-01',[a],new Date(instant('2028-01-01','09:00')));assert.equal(cells[0],true);assert.equal(cells[3],false);assert.equal(cells[4],true);assert.equal(cells[6],false);});
test('dokumentacja wymaga treści i poprawnej skali bólu',()=>{assert.throws(()=>validateEncounter({}));assert.throws(()=>validateEncounter({observations:'x',performed:'x',aftercare:'x',pain:11}));assert.doesNotThrow(()=>validateEncounter({observations:'x',performed:'x',aftercare:'x',pain:null}));});
test('demo: anulowanie zwalnia zakres, powtórzenie rezerwacji jest idempotentne',()=>{
 const s=seed(),d={id:crypto.randomUUID(),patient_id:'p1',service_id:'basic',...validateRange(shiftDay(dayKey(),7),'10:00','11:00')};demoAction(s,'book',d);demoAction(s,'book',d);assert.equal(s.appointments.filter(a=>a.id===d.id).length,1);assert.throws(()=>demoAction(s,'book',{...d,id:crypto.randomUUID()}));demoAction(s,'cancel',{id:d.id});assert.doesNotThrow(()=>demoAction(s,'book',{...d,id:crypto.randomUUID()}));
});
test('demo: zmiana profilu nie zmienia migawki wcześniejszej wizyty ani rezerwacji',()=>{
 const s=seed(),v=s.encounters[0],before=JSON.stringify(v.profile_snapshot);demoAction(s,'patient',{...s.patients[0],profile:{allergies:'Nowa informacja'}});assert.equal(JSON.stringify(v.profile_snapshot),before);
});
test('e-mail: ta sama lokalna godzina potwierdzenia i anulowania, bez danych zdrowotnych',()=>{
 const a={starts_at:instant('2026-09-06','10:00'),ends_at:instant('2026-09-06','11:00'),clinic_name:'PodoCare',clinic_address:'Test 1',service_name:'Tajna diagnoza'};
 for(const type of ['confirmed','cancelled','reminder']){const m=emailContent(a,type);assert(m.text.includes('10:00–11:00'));assert(!m.text.includes('Tajna diagnoza'));assert(!m.html.includes('Tajna diagnoza'));}
});
test('demo: edycja zabiegu nie tworzy duplikatu',()=>{const s=seed();demoAction(s,'service',{service_id:'basic',name:'Zmieniony',minutes:90,price:20000});assert.equal(s.services.length,9);assert.equal(s.services.find(x=>x.id==='basic').name,'Zmieniony');});
