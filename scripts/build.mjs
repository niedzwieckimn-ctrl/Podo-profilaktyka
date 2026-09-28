import {mkdir,copyFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve('.'),dist=join(root,'dist');
// CONTEXT jest zmienną etapu build, nie gwarantowaną zmienną runtime Functions.
await writeFile(join(root,'netlify/lib/deploy-context.js'),`// Wygenerowane podczas budowy. Nie edytuj ręcznie.\nexport const productionBuild = ${process.env.CONTEXT==='production'};\n`);
await mkdir(join(dist,'assets'),{recursive:true});
for(const name of ['index.html','manifest.webmanifest','service-worker.js'])await copyFile(join(root,name),join(dist,name));
for(const f of await readdir(join(root,'assets'),{withFileTypes:true}))if(f.isFile())await copyFile(join(root,'assets',f.name),join(dist,'assets',f.name));
console.log('Zbudowano dist: tylko interfejs. Backend, SQL i testy poza katalogiem publikowanym.');
