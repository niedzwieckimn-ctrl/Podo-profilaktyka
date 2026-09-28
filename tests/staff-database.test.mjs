import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {validateRange} from '../assets/domain.js';

test('panel personelu: migracje 001–004 i trwały zapis rozszerzeń',async t=>{
 const pg=new PGlite();
 await pg.exec('create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
 for(const name of ['001_podocare.sql','002_patient_photos.sql','003_staff_clinic.sql','004_clinic_setup.sql'])await pg.exec(await readFile(new URL('../supabase/'+name,import.meta.url),'utf8'));
 const actor=crypto.randomUUID(),outsider=crypto.randomUUID(),pid=crypto.randomUUID(),pid2=crypto.randomUUID(),cid=crypto.randomUUID(),cid2=crypto.randomUUID(),eid=crypto.randomUUID();
 await pg.query('insert into auth.users values($1),($2)',[actor,outsider]);await pg.query('insert into podo_admins values($1)',[actor]);
 const action=async(a,d,u=actor)=>(await pg.query('select podo_action($1,$2::jsonb,$3) result',[a,JSON.stringify(d),u])).rows[0].result;
 const child={id:pid,name:'Test dziecko',birth_date:'2020-02-10',email:'dziecko@example.invalid',profile:{guardian_name:'Opiekun Test',guardian_relation:'matka',guardian_email:'opiekun@example.invalid',allergies:'Testowa informacja'}};
 await t.test('start nie tworzy fikcyjnych pacjentów ani kont i ustawia 37 usług',async()=>{
  assert.equal((await pg.query('select count(*)::int n from podo_patients')).rows[0].n,0);
  assert.equal((await pg.query('select count(*)::int n from podo_services')).rows[0].n,37);
  assert.equal((await pg.query("select data->>'name' n from podo_settings")).rows[0].n,'Podo-Profilaktyka');
  assert.equal((await pg.query('select public from storage.buckets')).rows[0].public,false);
 });
 await t.test('dziecko wymaga opiekuna również bez walidacji UI',async()=>{
  await assert.rejects(action('patient',{...child,profile:{}}),/opiekuna/);
  await action('patient',child);await action('patient',{id:pid2,name:'Inny Test',profile:{}});
 });
 const bid=crypto.randomUUID(),booking={id:bid,patient_id:pid,service_id:'brace',price:19900,...validateRange('2036-09-28','10:00','11:00')};
 await t.test('rezerwacja używa uzgodnionej ceny i kontaktu opiekuna',async()=>{
  await action('book',booking);const a=(await pg.query('select * from podo_appointments')).rows[0];
  assert.equal(a.price,19900);assert.equal(a.patient_email,'opiekun@example.invalid');assert.equal(a.contact_snapshot.kind,'opiekun');
  assert.equal((await pg.query('select count(*)::int n from podo_mail')).rows[0].n,2);
  assert.equal((await action('book',booking)).reused,true);
  await assert.rejects(action('book',{...booking,price:21000}),/Konflikt/);
  await assert.rejects(action('book',{...booking,id:crypto.randomUUID()}),/zajęty/);
 });
 await t.test('zmiana opiekuna nie przepisuje kontaktu istniejącej wizyty',async()=>{
  await action('patient',{...child,profile:{...child.profile,guardian_email:'nowy@example.invalid'}});
  assert.equal((await pg.query('select patient_email from podo_appointments')).rows[0].patient_email,'opiekun@example.invalid');
 });
 await t.test('problem zapisuje się, ponowienie nie dubluje wpisu',async()=>{
  const c={id:cid,patient_id:pid,title:'Kontrola testowa',location:'Lewa stopa · paluch',goal:'Test'};
  await action('case',c);assert.equal((await action('case',c)).reused,true);
  await assert.rejects(action('case',{...c,patient_id:pid2}),/Konflikt/);
  await action('case',{...c,id:cid2,patient_id:pid2});
 });
 const encounter={id:eid,patient_id:pid,case_id:cid,appointment_id:bid,observations:'Test',performed:'Test kontroli',aftercare:'Test zaleceń',pain:0,amount:19900,paid:true};
 await t.test('dokumentacja nie może wejść do problemu innego pacjenta',async()=>{
  await assert.rejects(action('encounter',{...encounter,case_id:cid2}),/tego pacjenta/);
  assert.equal((await pg.query('select status from podo_appointments')).rows[0].status,'confirmed');
  await action('encounter',encounter);assert.equal((await pg.query('select case_id from podo_encounters')).rows[0].case_id,cid);
  assert.equal((await pg.query("select state from podo_mail where kind='reminder'")).rows[0].state,'cancelled');
 });
 await t.test('uzupełnienie zachowuje pacjenta, problem i niezmienność historii',async()=>{
  await assert.rejects(action('encounter',{...encounter,id:crypto.randomUUID(),appointment_id:null,amends_id:eid,case_id:null}),/uzupełnienie/);
  await action('encounter',{...encounter,id:crypto.randomUUID(),appointment_id:null,amends_id:eid,amount:0});
  await assert.rejects(pg.query("update podo_encounters set aftercare='zmiana'"),/niezmienne/);
 });
 const photoId=crypto.randomUUID(),photo={id:photoId,patient_id:pid,case_id:cid,encounter_id:eid,phase:'before',taken_on:'2026-01-01',storage_path:`${pid}/${photoId}.jpg`,sha256:'a'.repeat(64),width:100,height:100};
 const savePhoto=async(d,u=actor)=>(await pg.query('select podo_add_photo($1::jsonb,$2) result',[JSON.stringify(d),u])).rows[0].result;
 await t.test('zdjęcie trwale zachowuje problem, wizytę, etap i datę',async()=>{
  await savePhoto(photo);assert.equal((await savePhoto(photo)).reused,true);
  const p=(await pg.query('select * from podo_photos')).rows[0];assert.equal(p.case_id,cid);assert.equal(p.encounter_id,eid);assert.equal(p.phase,'before');assert.equal(p.taken_on.getUTCFullYear(),2026);
  await assert.rejects(savePhoto({...photo,phase:'after'}),/Konflikt/);
  await assert.rejects(pg.query("update podo_photos set phase='after'"),/niezmienne/);
 });
 await t.test('błędne powiązania i przyszła data zdjęcia są blokowane',async()=>{
  await assert.rejects(savePhoto({...photo,case_id:cid2}),/tego pacjenta/);
  await assert.rejects(savePhoto({...photo,case_id:null}),/innego pacjenta lub problemu/);
  await assert.rejects(savePhoto({...photo,taken_on:'2099-01-01'}),/datę/);
  await assert.rejects(savePhoto(photo,outsider),/Brak uprawnień/);
 });
 await t.test('zamykanie i wznowienie terapii ma trwały, niezmienny audyt',async()=>{
  await action('case-status',{id:cid,patient_id:pid,status:'closed'});await action('case-status',{id:cid,patient_id:pid,status:'closed'});await action('case-status',{id:cid,patient_id:pid,status:'active'});
  assert.equal((await pg.query('select count(*)::int n from podo_case_events where case_id=$1',[cid])).rows[0].n,3);
  assert.equal((await pg.query('select count(*)::int n from podo_photos')).rows[0].n,1);
  await assert.rejects(pg.query('delete from podo_case_events'),/niezmienne/);
 });
 await t.test('widełki i ustawienia profilu zachowują się po zapisie',async()=>{
  await action('service',{service_id:'brace',name:'Klamra',category:'Klamry',minutes:60,price:17000,price_max:24000,price_note:'Wariant',time_confirmed:true});
  await assert.rejects(action('service',{service_id:'bad',name:'Test',minutes:30,price:200,price_max:100}),/podo_service_price_range/);
  await action('settings',{name:'Podo-Profilaktyka',address:'Testowy adres',reminders:false});
  assert.equal((await pg.query("select data->>'practitioner' p from podo_settings")).rows[0].p,'Katarzyna Kosak');
  assert.equal((await pg.query("select price from podo_appointments where id=$1",[bid])).rows[0].price,19900);
 });
 await t.test('anulowanie kasuje oczekujące wysyłki, nie dokumentację',async()=>{
  const id=crypto.randomUUID();await action('book',{...booking,id,...validateRange('2036-09-29','10:00','11:00')});
  await action('cancel',{id});const jobs=(await pg.query('select * from podo_mail where appointment_id=$1',[id])).rows;
  assert(jobs.filter(x=>x.kind!=='cancelled').every(x=>x.state==='cancelled'));assert.equal(jobs.find(x=>x.kind==='cancelled').state,'pending');
 });
 await t.test('brak publicznych zapisów, odczytów i ról pacjentów',async()=>{
  for(const role of ['anon','authenticated']){await pg.exec(`set role ${role}`);for(const table of ['podo_patients','podo_cases','podo_case_events','podo_photos','podo_appointments'])await assert.rejects(pg.query('select * from '+table),/permission denied/);await assert.rejects(action('book',booking),/permission denied/);await assert.rejects(savePhoto(photo),/permission denied/);await pg.exec('reset role');}
  await assert.rejects(action('case',{id:crypto.randomUUID(),patient_id:pid,title:'X',location:'X'},outsider),/Brak uprawnień/);
  await assert.rejects(action('public-book',booking),/Nieznana/);
 });
 await t.test('ponowne uruchomienie cennika startowego nie nadpisuje danych',async()=>{
  await assert.rejects(pg.exec(await readFile(new URL('../supabase/004_clinic_setup.sql',import.meta.url),'utf8')),/pustej, nowej/);await pg.exec('rollback');
  assert.equal((await pg.query('select count(*)::int n from podo_patients')).rows[0].n,2);
 });
 await pg.close();
});
