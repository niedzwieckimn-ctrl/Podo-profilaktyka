export const json=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
export async function db(path,{method='GET',body,prefer}={}) {
 const {SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:key}=process.env;
 if(!url||!key) throw Error('Brak konfiguracji serwera Supabase.');
 const r=await fetch(`${url}/rest/v1/${path}`,{method,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const data=await r.json().catch(()=>null);
 if(!r.ok) {const e=Error(data?.message||'Błąd bazy danych.');e.status=400;throw e;}return data;
}
export async function admin(event) {
 const token=(event.headers.authorization||event.headers.Authorization||'').replace(/^Bearer /i,'');
 if(!token)throw Object.assign(Error('Zaloguj się ponownie.'),{status:401});
 const {SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:key}=process.env;
 if(!url||!key)throw Object.assign(Error('Serwer nie został skonfigurowany.'),{status:503});
 const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Object.assign(Error('Sesja wygasła. Zaloguj się.'),{status:401});
 const user=await r.json();
 if(!user.id||!(/^[a-f0-9-]{36}$/i).test(user.id))throw Object.assign(Error('Nieprawidłowa sesja.'),{status:401});
 const memberships=await db(`podo_admins?user_id=eq.${user.id}&select=user_id`);
 if(!memberships.length)throw Object.assign(Error('Brak dostępu do gabinetu.'),{status:403});
 return user;
}
export async function all(table,order='id') {
 const out=[];
 for(let offset=0;offset<20000;offset+=500) {
  const page=await db(`${table}?select=*&order=${order}&limit=500&offset=${offset}`);out.push(...page);
  if(page.length<500)return out;
 }
 throw Error('Przekroczono rozmiar kartoteki V1. Wymagana stronicowana wersja API.');
}
export function validateOrigin(event) {
 const origin=event.headers.origin;
 const host=event.headers.host||event.headers['x-forwarded-host'];
 if(origin&&new URL(origin).host!==host)throw Object.assign(Error('Niedozwolone źródło żądania.'),{status:403});
}
