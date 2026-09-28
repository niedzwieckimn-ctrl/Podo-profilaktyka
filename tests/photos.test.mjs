import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {preparePhoto} from '../netlify/lib/photos.js';
test('zdjęcie jest pomniejszane i pozbawiane EXIF na serwerze',async()=>{
 const source=await sharp({create:{width:2000,height:1000,channels:3,background:'#abcdab'}}).jpeg().withExif({IFD0:{Artist:'Dane prywatne',Copyright:'Nie przekazuj'}}).toBuffer();
 assert((await sharp(source).metadata()).exif);
 const result=await preparePhoto(source.toString('base64')),meta=await sharp(result.buffer).metadata();
 assert.equal(meta.width,1600);assert.equal(meta.height,800);assert.equal(meta.format,'jpeg');assert.equal(meta.exif,undefined);assert.equal(result.sha256.length,64);
});
test('uszkodzone i za duże zdjęcia są odrzucane',async()=>{await assert.rejects(preparePhoto(Buffer.from('not an image').toString('base64')),/odczytać/);await assert.rejects(preparePhoto('a'.repeat(2800001)),/duże/);});
test('migracja prywatnych zdjęć: właściciel, izolacja, idempotencja',async()=>{
 const pg=new PGlite();await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
 for(const file of ['001_podocare.sql','002_patient_photos.sql'])await pg.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 const actor=crypto.randomUUID(),pid=crypto.randomUUID(),other=crypto.randomUUID(),id=crypto.randomUUID();
 await pg.query('insert into auth.users values($1)',[actor]);await pg.query('insert into podo_admins values($1)',[actor]);await pg.query('insert into podo_patients(id,name) values($1,$2),($3,$4)',[pid,'Fikcyjny',other,'Inny']);
 const d={id,patient_id:pid,storage_path:`${pid}/${id}.jpg`,sha256:'a'.repeat(64),width:100,height:100};
 const save=data=>pg.query('select podo_add_photo($1::jsonb,$2) result',[JSON.stringify(data),actor]);
 await save(d);const again=(await save(d)).rows[0].result;assert.equal(again.reused,true);
 await assert.rejects(save({...d,patient_id:other,storage_path:`${other}/${id}.jpg`}),/Konflikt/);
 await assert.rejects(save({...d,storage_path:'another/path.jpg'}),/ścieżka/);
 assert.equal((await pg.query('select public from storage.buckets')).rows[0].public,false);
 await pg.exec('set role authenticated');await assert.rejects(pg.query('select * from podo_photos'),/permission denied/);await pg.exec('reset role');await pg.close();
});
