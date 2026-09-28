import {mkdir,copyFile,readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const root=resolve('.'),target=resolve('../../outputs/PODO-PROFILAKTYKA-PERSONEL-V2-2026-09-28');
const files=['.gitignore','.env.example','index.html','manifest.webmanifest','service-worker.js','netlify.toml','package.json','pnpm-lock.yaml','README.md','WDROZENIE.md','TESTY.md','FUTURE-PATIENT-PORTAL.md','URUCHOM-DEMO.cmd'];
async function visit(folder){for(const f of await readdir(join(root,folder),{withFileTypes:true})){const rel=folder+'/'+f.name;if(f.isDirectory())await visit(rel);else if(f.name!=='package-clinic-demo.mjs'&&f.name!=='INSTALL-FRESH.sql')files.push(rel);}}
for(const folder of ['assets','netlify','supabase','scripts','tests'])await visit(folder);
await mkdir(target,{recursive:true});
for(const f of files){await mkdir(resolve(target,f,'..'),{recursive:true});await copyFile(join(root,f),join(target,f));}
// Jedna transakcja dla świeżej instalacji, bez częściowego zastosowania migracji.
const migrations=['001_podocare.sql','002_patient_photos.sql','003_staff_clinic.sql','004_clinic_setup.sql'];
const fresh='-- NOWA PUSTA BAZA PODO-PROFILAKTYKI. NIE URUCHAMIAJ W BAZIE SPA.\n-- Zawiera 001–004; nie uruchamiaj tych migracji ponownie.\nbegin;\n'+(await Promise.all(migrations.map(async f=>'\n-- '+f+'\n'+(await readFile(join(root,'supabase',f),'utf8')).replace(/^begin;\r?\n/gm,'').replace(/^commit;\r?\n?/gm,'')))).join('\n')+'\ncommit;\n';
const pg=new PGlite();await pg.exec('create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');await pg.exec(fresh);
const n=(await pg.query('select count(*)::int n from podo_services')).rows[0].n;if(n!==37)throw Error('Błąd instalatora');await pg.close();
await writeFile(join(target,'supabase/INSTALL-FRESH.sql'),fresh);files.push('supabase/INSTALL-FRESH.sql');
// Archiwum źródeł jest bezpieczne również po lokalnym buildzie production.
await writeFile(join(target,'netlify/lib/deploy-context.js'),'// Wartość zostanie wygenerowana przez build Netlify.\nexport const productionBuild = false;\n');
const manifest=[];for(const f of files.sort())manifest.push(createHash('sha256').update(await readFile(join(target,f))).digest('hex')+'  '+f);
await writeFile(join(target,'MANIFEST-SHA256.txt'),manifest.join('\n')+'\n');
console.log(JSON.stringify({target,files:files.length,installer_test:'PostgreSQL: 37 usług, pusta kartoteka',manifest:'MANIFEST-SHA256.txt'},null,2));
