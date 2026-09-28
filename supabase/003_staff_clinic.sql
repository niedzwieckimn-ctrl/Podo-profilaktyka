-- Po 001 i 002. Rozszerzenia panelu personelu. Bez publicznego panelu rezerwacji.
begin;
create table public.podo_cases (
 id uuid primary key, patient_id uuid not null references public.podo_patients(id),
 title text not null check(length(trim(title)) between 1 and 200),
 location text not null check(length(trim(location)) between 1 and 200),
 goal text not null default '', status text not null default 'active' check(status in ('active','closed')),
 created_at timestamptz not null default now(), created_by uuid not null references auth.users(id),
 unique(id,patient_id)
);
create index on public.podo_cases(patient_id,created_at);
create table public.podo_case_events (
 id bigint generated always as identity primary key, case_id uuid not null references public.podo_cases(id),
 status text not null check(status in ('active','closed')), actor uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create trigger podo_case_events_immutable before update or delete on public.podo_case_events for each row execute function public.podo_no_rewrite();
alter table public.podo_encounters add column case_id uuid;
alter table public.podo_encounters add constraint podo_encounter_case_patient foreign key(case_id,patient_id) references public.podo_cases(id,patient_id);
alter table public.podo_encounters add constraint podo_encounter_patient_unique unique(id,patient_id);
alter table public.podo_photos add column case_id uuid;
alter table public.podo_photos add column encounter_id uuid;
alter table public.podo_photos add column phase text not null default 'control' check(phase in ('before','control','after'));
alter table public.podo_photos add column taken_on date;
alter table public.podo_photos add constraint podo_photo_case_patient foreign key(case_id,patient_id) references public.podo_cases(id,patient_id);
alter table public.podo_photos add constraint podo_photo_encounter_patient foreign key(encounter_id,patient_id) references public.podo_encounters(id,patient_id);
create trigger podo_photos_immutable before update or delete on public.podo_photos for each row execute function public.podo_no_rewrite();
alter table public.podo_services add column price_max integer;
update public.podo_services set price_max=price;
alter table public.podo_services add constraint podo_service_price_range check(price_max is null or price_max>=price);
alter table public.podo_services add column price_note text not null default '';
alter table public.podo_services add column time_confirmed boolean not null default false;
alter table public.podo_appointments add column contact_snapshot jsonb not null default '{}';
do $$ declare t text; begin
 foreach t in array array['podo_cases','podo_case_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.podo_case_events_id_seq to service_role;

-- Wspólna walidacja także przy bezpośrednim wywołaniu RPC przez backend.
create function public.podo_contact(p_birth date,p_profile jsonb,p_name text,p_email text,p_phone text) returns jsonb
language plpgsql set search_path=public as $$
declare guardian boolean;
begin
 if p_birth>(now() at time zone 'Europe/Warsaw')::date then raise exception 'Nieprawidłowa data urodzenia'; end if;
 guardian:=coalesce(case when p_birth is not null then p_birth>((now() at time zone 'Europe/Warsaw')::date-interval '18 years')::date else p_profile->>'patient_kind'='child' end,false) or coalesce(p_profile->>'contact_target'='guardian',false);
 if guardian then
  if trim(coalesce(p_profile->>'guardian_name',''))='' or trim(coalesce(p_profile->>'guardian_relation',''))='' or (trim(coalesce(p_profile->>'guardian_email',''))='' and trim(coalesce(p_profile->>'guardian_phone',''))='') then raise exception 'Uzupełnij dane i kontakt opiekuna'; end if;
  if coalesce(p_profile->>'guardian_email','')<>'' and p_profile->>'guardian_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Sprawdź e-mail opiekuna'; end if;
  return jsonb_build_object('kind','opiekun','name',p_profile->>'guardian_name','email',coalesce(p_profile->>'guardian_email',''),'phone',coalesce(p_profile->>'guardian_phone',''));
 end if;
 return jsonb_build_object('kind','pacjent','name',p_name,'email',coalesce(p_email,''),'phone',coalesce(p_phone,''));
end $$;
revoke all on function public.podo_contact(date,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.podo_contact(date,jsonb,text,text,text) to service_role;

create or replace function public.podo_action(p_action text,p_data jsonb,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 v_id uuid; p podo_patients; s podo_services; a podo_appointments; c podo_cases; v podo_encounters;
 conf jsonb; contact jsonb; cid uuid; agreed_price integer;
 st timestamptz; en timestamptz; local_st timestamp; local_en timestamp;
begin
 if not exists(select 1 from podo_admins where user_id=p_actor) then raise exception 'Brak uprawnień'; end if;
 v_id:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
 if p_action='patient' then
  perform podo_contact(nullif(p_data->>'birth_date','')::date,coalesce(p_data->'profile','{}'),p_data->>'name',p_data->>'email',p_data->>'phone');
  insert into podo_patients(id,name,email,phone,birth_date,profile) values(v_id,trim(p_data->>'name'),coalesce(p_data->>'email',''),coalesce(p_data->>'phone',''),nullif(p_data->>'birth_date','')::date,coalesce(p_data->'profile','{}'))
  on conflict(id) do update set name=excluded.name,email=excluded.email,phone=excluded.phone,birth_date=excluded.birth_date,profile=excluded.profile,updated_at=now();
 elsif p_action='book' then
  perform pg_advisory_xact_lock(9282026);
  select * into a from podo_appointments where id=v_id;
  if found then
   if a.patient_id is distinct from (p_data->>'patient_id')::uuid or a.service_id is distinct from p_data->>'service_id' or a.starts_at is distinct from (p_data->>'starts_at')::timestamptz or a.ends_at is distinct from (p_data->>'ends_at')::timestamptz or (p_data ? 'price' and a.price is distinct from (p_data->>'price')::integer) then raise exception 'Konflikt identyfikatora wizyty'; end if;
   return jsonb_build_object('id',v_id,'reused',true);
  end if;
  select * into strict p from podo_patients where id=(p_data->>'patient_id')::uuid for share;
  select * into strict s from podo_services where id=p_data->>'service_id' and active;
  select data into conf from podo_settings where id='clinic';
  contact:=podo_contact(p.birth_date,p.profile,p.name,p.email,p.phone);
  agreed_price:=coalesce((p_data->>'price')::integer,s.price);
  if agreed_price<0 or agreed_price>10000000 then raise exception 'Nieprawidłowa cena wizyty'; end if;
  st:=(p_data->>'starts_at')::timestamptz;en:=(p_data->>'ends_at')::timestamptz;
  local_st:=st at time zone 'Europe/Warsaw';local_en:=en at time zone 'Europe/Warsaw';
  if st is null or en is null or st<=now() or en<=st or local_st::date<>local_en::date or local_st::time<'08:00' or local_en::time>'20:00'
   or extract(minute from local_st)::int%30<>0 or extract(minute from local_en)::int%30<>0 or extract(second from local_st)<>0 or extract(second from local_en)<>0 then raise exception 'Nieprawidłowy zakres godzin';end if;
  if exists(select 1 from podo_appointments where status<>'cancelled' and starts_at<en and ends_at>st) then raise exception 'Ten zakres jest już zajęty';end if;
  insert into podo_appointments(id,patient_id,service_id,starts_at,ends_at,patient_name,patient_email,service_name,price,clinic_name,clinic_address,note,contact_snapshot)
   values(v_id,p.id,s.id,st,en,p.name,contact->>'email',s.name,agreed_price,conf->>'name',coalesce(conf->>'address',''),coalesce(p_data->>'note',''),contact);
  if contact->>'email'<>'' then
   insert into podo_mail(appointment_id,kind,due_at) values(v_id,'confirmed',now());
   if coalesce((conf->>'reminders')::boolean,true) and st-interval '24 hours'>now() then insert into podo_mail(appointment_id,kind,due_at) values(v_id,'reminder',st-interval '24 hours');end if;
  end if;
 elsif p_action='cancel' then
  select * into strict a from podo_appointments where id=v_id for update;
  if a.status='cancelled' then return jsonb_build_object('id',v_id,'reused',true);end if;
  if a.status<>'confirmed' then raise exception 'Nie można anulować zakończonej wizyty';end if;
  update podo_appointments set status='cancelled',revision=revision+1 where id=v_id;
  update podo_mail set state='cancelled',lease_until=null where appointment_id=v_id and state in('pending','leased') and kind<>'cancelled';
  if a.patient_email<>'' then insert into podo_mail(appointment_id,kind,due_at) values(v_id,'cancelled',now()) on conflict do nothing;end if;
 elsif p_action='case' then
  select * into c from podo_cases where id=v_id;
  if found then
   if c.patient_id is distinct from (p_data->>'patient_id')::uuid or c.title is distinct from trim(p_data->>'title') or c.location is distinct from trim(p_data->>'location') or c.goal is distinct from coalesce(p_data->>'goal','') then raise exception 'Konflikt identyfikatora problemu';end if;
   return jsonb_build_object('id',v_id,'reused',true);
  end if;
  insert into podo_cases(id,patient_id,title,location,goal,created_by) values(v_id,(p_data->>'patient_id')::uuid,trim(p_data->>'title'),trim(p_data->>'location'),coalesce(p_data->>'goal',''),p_actor);
  insert into podo_case_events(case_id,status,actor) values(v_id,'active',p_actor);
 elsif p_action='case-status' then
  select * into strict c from podo_cases where id=v_id and patient_id=(p_data->>'patient_id')::uuid for update;
  if c.status=p_data->>'status' then return jsonb_build_object('id',v_id,'reused',true);end if;
  update podo_cases set status=p_data->>'status' where id=v_id;
  insert into podo_case_events(case_id,status,actor) values(v_id,p_data->>'status',p_actor);
 elsif p_action='encounter' then
  cid:=nullif(p_data->>'case_id','')::uuid;
  select * into v from podo_encounters where id=v_id;
  if found then
   if v.patient_id is distinct from (p_data->>'patient_id')::uuid or v.case_id is distinct from cid or v.observations is distinct from p_data->>'observations' or v.performed is distinct from p_data->>'performed' or v.aftercare is distinct from p_data->>'aftercare' then raise exception 'Konflikt identyfikatora dokumentacji';end if;
   return jsonb_build_object('id',v_id,'reused',true);
  end if;
  select * into strict p from podo_patients where id=(p_data->>'patient_id')::uuid for share;
  if cid is not null and not exists(select 1 from podo_cases where id=cid and patient_id=p.id) then raise exception 'Problem musi należeć do tego pacjenta';end if;
  if nullif(p_data->>'amends_id','') is not null then
   if nullif(p_data->>'appointment_id','') is not null then raise exception 'Uzupełnienie nie może kończyć innej wizyty';end if;
   if not exists(select 1 from podo_encounters where id=(p_data->>'amends_id')::uuid and patient_id=p.id and case_id is not distinct from cid) then raise exception 'Nieprawidłowe uzupełnienie lub problem';end if;
  end if;
  if nullif(p_data->>'appointment_id','') is not null then
   select * into strict a from podo_appointments where id=(p_data->>'appointment_id')::uuid and patient_id=p.id for update;
   if a.status<>'confirmed' then raise exception 'Wizyta nie jest aktywna';end if;
   update podo_appointments set status='completed' where id=a.id;
   update podo_mail set state='cancelled' where appointment_id=a.id and kind='reminder' and state in('pending','leased');
  end if;
  insert into podo_encounters(id,patient_id,appointment_id,amends_id,case_id,created_by,observations,performed,aftercare,products,zones,pain,followup_date,profile_snapshot,amount,paid)
   values(v_id,p.id,nullif(p_data->>'appointment_id','')::uuid,nullif(p_data->>'amends_id','')::uuid,cid,p_actor,p_data->>'observations',p_data->>'performed',p_data->>'aftercare',coalesce(p_data->>'products',''),coalesce(p_data->'zones','[]'),nullif(p_data->>'pain','')::int,nullif(p_data->>'followup_date','')::date,p.profile,coalesce((p_data->>'amount')::int,0),coalesce((p_data->>'paid')::boolean,false));
 elsif p_action='idea' then
  if length(trim(coalesce(p_data->>'title','')))=0 or length(trim(coalesce(p_data->>'content','')))=0 then raise exception 'Pusty pomysł';end if;
  insert into podo_ideas(id,title,content,category,created_by) values(v_id,p_data->>'title',p_data->>'content',coalesce(p_data->>'category','Pomysł'),p_actor) on conflict(id) do nothing;
 elsif p_action='service' then
  insert into podo_services(id,name,category,minutes,price,price_max,price_note,time_confirmed,active) values(p_data->>'service_id',p_data->>'name',coalesce(p_data->>'category',''),(p_data->>'minutes')::int,(p_data->>'price')::int,case when p_data ? 'price_max' then (p_data->>'price_max')::int else (p_data->>'price')::int end,coalesce(p_data->>'price_note',''),coalesce((p_data->>'time_confirmed')::boolean,false),true)
   on conflict(id) do update set name=excluded.name,category=excluded.category,minutes=excluded.minutes,price=excluded.price,price_max=excluded.price_max,price_note=excluded.price_note,time_confirmed=excluded.time_confirmed;
 elsif p_action='settings' then
  if length(trim(coalesce(p_data->>'name','')))=0 then raise exception 'Podaj nazwę gabinetu';end if;
  update podo_settings set data=data||p_data where id='clinic';
 else raise exception 'Nieznana czynność';end if;
 insert into podo_audit(actor,action,entity_id) values(p_actor,p_action,coalesce(p_data->>'service_id',v_id::text));
 return jsonb_build_object('id',v_id);
end $$;
revoke all on function public.podo_action(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.podo_action(text,jsonb,uuid) to service_role;

create or replace function public.podo_add_photo(p_data jsonb,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_id uuid:=(p_data->>'id')::uuid; pid uuid:=(p_data->>'patient_id')::uuid; old podo_photos;
 cid uuid:=nullif(p_data->>'case_id','')::uuid; eid uuid:=nullif(p_data->>'encounter_id','')::uuid;
 phase_value text:=coalesce(p_data->>'phase','control'); date_value date:=coalesce(nullif(p_data->>'taken_on','')::date,(now() at time zone 'Europe/Warsaw')::date);
begin
 if not exists(select 1 from podo_admins where user_id=p_actor) then raise exception 'Brak uprawnień';end if;
 if not exists(select 1 from podo_patients where id=pid) then raise exception 'Nie znaleziono pacjenta';end if;
 if p_data->>'storage_path' is distinct from pid::text||'/'||v_id::text||'.jpg' then raise exception 'Nieprawidłowa ścieżka zdjęcia';end if;
 if date_value>(now() at time zone 'Europe/Warsaw')::date or phase_value not in ('before','control','after') then raise exception 'Sprawdź datę i etap zdjęcia';end if;
 if cid is not null and not exists(select 1 from podo_cases where id=cid and patient_id=pid) then raise exception 'Problem musi należeć do tego pacjenta';end if;
 if eid is not null and not exists(select 1 from podo_encounters where id=eid and patient_id=pid and case_id is not distinct from cid) then raise exception 'Wizyta dotyczy innego pacjenta lub problemu';end if;
 select * into old from podo_photos where id=v_id;
 if found then
  if old.patient_id is distinct from pid or old.sha256 is distinct from p_data->>'sha256' or old.case_id is distinct from cid or old.encounter_id is distinct from eid or old.phase is distinct from phase_value or coalesce(old.taken_on,(old.created_at at time zone 'Europe/Warsaw')::date) is distinct from date_value then raise exception 'Konflikt identyfikatora zdjęcia';end if;
  return jsonb_build_object('id',v_id,'reused',true);
 end if;
 insert into podo_photos(id,patient_id,created_by,storage_path,sha256,width,height,case_id,encounter_id,phase,taken_on)
 values(v_id,pid,p_actor,p_data->>'storage_path',p_data->>'sha256',(p_data->>'width')::int,(p_data->>'height')::int,cid,eid,phase_value,date_value);
 insert into podo_audit(actor,action,entity_id) values(p_actor,'photo',v_id::text);
 return jsonb_build_object('id',v_id);
end $$;
revoke all on function public.podo_add_photo(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.podo_add_photo(jsonb,uuid) to service_role;
commit;
