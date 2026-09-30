import {esc,date,time} from './domain.js';
export function photoSection(state,patientId){
 const photos=(state.photos||[]).filter(p=>p.patient_id===patientId).sort((a,b)=>b.created_at.localeCompare(a.created_at));
 return `<section class="panel photo-panel"><div class="panel-heading"><div><span class="eyebrow">DOKUMENTACJA FOTOGRAFICZNA</span><h2>Zdjęcia pacjenta <small>(${photos.length})</small></h2></div><div class="photo-actions"><label class="primary small-button">Zrób zdjęcie<input type="file" accept="image/*" capture="environment" data-photo-input="${patientId}" class="file-input"></label><label class="outline small-button">Z galerii<input type="file" accept="image/*" data-photo-input="${patientId}" class="file-input"></label></div></div><div class="soft-note">Po zatwierdzeniu w aparacie zdjęcie automatycznie trafi do tej karty: <b>${esc(state.patients.find(p=>p.id===patientId)?.name)}</b>. Fotografuj tylko niezbędny obszar stopy. Bez twarzy, dokumentów i osób postronnych.</div>${photos.length?`<div class="photo-grid">${photos.map(p=>`<button class="photo-card" data-photo-view="${p.id}"><div class="photo-loading">Wczytywanie prywatnego zdjęcia…</div><img data-photo="${p.id}" alt="Dokumentacja stopy, ${date(p.created_at)}" hidden><span>${date(p.created_at)} <small>${time(p.created_at)}</small></span></button>`).join('')}</div>`:'<div class="empty"><p>Przebieg zmian warto dokumentować w tym samym świetle i z podobnej odległości.</p></div>'}</section>`;
}
export async function compressPhoto(file){
 if(!file||file.size>20000000)throw Error('Wybierz zdjęcie do 20 MB.');
 let bitmap;
 try{bitmap=await createImageBitmap(file);}catch{throw Error('Telefon nie udostępnił obrazu. Spróbuj JPEG / PNG lub zmień format aparatu z HEIC na JPEG.');}
 try{
  const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));
  if(!blob||blob.size>2097152)throw Error('Nie udało się przygotować zdjęcia do wysłania.');
  const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(blob);});
  return {base64,blob,width:canvas.width,height:canvas.height};
 }finally{bitmap.close();}
}
