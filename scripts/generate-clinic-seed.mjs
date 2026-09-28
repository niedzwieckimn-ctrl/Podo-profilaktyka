import {writeFile} from 'node:fs/promises';
import {CLINIC,CLINIC_SERVICES} from '../assets/clinic-profile.js';
const q=v=>v===null?'null':typeof v==='number'||typeof v==='boolean'?String(v):"'"+String(v).replaceAll("'","''")+"'";
const sql=`-- Jednorazowa konfiguracja NOWEGO, pustego gabinetu po 001–003.
-- Nie uruchamiaj ponownie: nie nadpisujemy uzgodnionego cennika ani ustawień.
begin;
do $$ begin
 if exists(select 1 from public.podo_patients) or exists(select 1 from public.podo_appointments)
  or exists(select 1 from public.podo_audit) or (select data->>'name' from public.podo_settings where id='clinic') is distinct from 'PodoCare'
 then raise exception 'Konfiguracja startowa wymaga pustej, nowej bazy PodoCare. Nie zmieniono danych.'; end if;
end $$;
update public.podo_settings set data=${q(JSON.stringify({...CLINIC,reminders:true}))}::jsonb where id='clinic';
insert into public.podo_services(id,name,category,minutes,price,price_max,price_note,time_confirmed) values
${CLINIC_SERVICES.map(s=>' ('+[s.id,s.name,s.category,s.minutes,s.price,s.price_max,s.price_note,s.time_confirmed].map(q).join(',')+')').join(',\n')}
on conflict(id) do update set name=excluded.name,category=excluded.category,minutes=excluded.minutes,price=excluded.price,price_max=excluded.price_max,price_note=excluded.price_note,time_confirmed=excluded.time_confirmed;
commit;
`;
await writeFile(new URL('../supabase/004_clinic_setup.sql',import.meta.url),sql);
console.log('Wygenerowano konfigurację gabinetu i 37 zabiegów; bez pacjentów i kont.');
