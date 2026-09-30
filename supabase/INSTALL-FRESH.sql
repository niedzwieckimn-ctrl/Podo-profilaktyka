-- NOWA PUSTA BAZA PODO-PROFILAKTYKI. NIE URUCHAMIAJ W BAZIE SPA.
-- Zawiera 001–005; nie uruchamiaj tych migracji ponownie.
begin;

-- 001_podocare.sql
-- PodoCare 1.0. Uruchomić w NOWYM projekcie Supabase, nie w bazie Massages.
create table public.podo_admins (user_id uuid primary key references auth.users(id));
create table public.podo_patients (
 id uuid primary key, name text not null check(length(trim(name)) between 1 and 200),
 email text not null default '', phone text not null default '', birth_date date,
 profile jsonb not null default '{}' check(jsonb_typeof(profile)='object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.podo_services (
 id text primary key, name text not null, category text not null default '',
 minutes integer not null check(minutes between 30 and 720 and minutes%30=0),
 price integer not null check(price>=0), active boolean not null default true
);
create table public.podo_settings (id text primary key check(id='clinic'), data jsonb not null);
insert into public.podo_settings values ('clinic','{"name":"PodoCare","address":"","phone":"","email":"","reminders":true}');
insert into public.podo_services(id,name,category,minutes,price) values
 ('consult','Konsultacja podologiczna','Diagnostyka i plan',30,10000),
 ('basic','Podstawowy zabieg podologiczny','Pielęgnacja stóp',60,18000),
 ('corn','Opracowanie odcisku / modzela','Skóra stóp',30,10000),
 ('heel','Opracowanie pękających pięt','Skóra stóp',60,15000),
 ('ingrown','Opracowanie wrastającego paznokcia','Paznokcie',60,18000),
 ('brace','Założenie klamry ortonyksyjnej','Paznokcie',60,22000),
 ('brace-check','Kontrola klamry','Wizyta kontrolna',30,8000),
 ('nails','Opracowanie zmienionej płytki paznokcia','Paznokcie',60,16000),
 ('check','Wizyta kontrolna / zmiana opatrunku','Wizyta kontrolna',30,8000);
create table public.podo_appointments (
 id uuid primary key, patient_id uuid not null references public.podo_patients(id),
 service_id text not null references public.podo_services(id), starts_at timestamptz not null, ends_at timestamptz not null,
 status text not null default 'confirmed' check(status in ('confirmed','cancelled','completed')),
 patient_name text not null, patient_email text not null, service_name text not null, price integer not null check(price>=0),
 clinic_name text not null, clinic_address text not null, note text not null default '', revision integer not null default 1,
 created_at timestamptz not null default now(), check(ends_at>starts_at)
);
create index on public.podo_appointments(patient_id,starts_at);
create table public.podo_encounters (
 id uuid primary key, patient_id uuid not null references public.podo_patients(id),
 appointment_id uuid unique references public.podo_appointments(id),
 amends_id uuid references public.podo_encounters(id),
 created_at timestamptz not null default now(), created_by uuid not null references auth.users(id),
 observations text not null check(length(trim(observations))>0), performed text not null check(length(trim(performed))>0),
 aftercare text not null check(length(trim(aftercare))>0), products text not null default '',
 zones jsonb not null default '[]', pain integer check(pain between 0 and 10), followup_date date,
 profile_snapshot jsonb not null, amount integer not null default 0 check(amount>=0), paid boolean not null default false
);
create index on public.podo_encounters(patient_id,created_at);
create table public.podo_ideas(id uuid primary key,title text not null,content text not null,category text not null default 'Pomysł',created_at timestamptz not null default now(),created_by uuid not null references auth.users(id));
create table public.podo_audit(id bigint generated always as identity primary key,actor uuid not null,action text not null,entity_id text not null,created_at timestamptz not null default now());
create table public.podo_mail (
 id uuid primary key default gen_random_uuid(), appointment_id uuid not null references public.podo_appointments(id),
 kind text not null check(kind in ('confirmed','cancelled','reminder')),due_at timestamptz not null,
 state text not null default 'pending' check(state in ('pending','leased','sent','failed','cancelled')),
 attempts integer not null default 0, lease_until timestamptz, first_attempt_at timestamptz,
 provider_id text, last_error text, sent_at timestamptz, unique(appointment_id,kind)
);
create function public.podo_no_rewrite() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Historia wizyty i audyt są niezmienne. Dodaj uzupełnienie.'; end; $$;
create trigger podo_encounter_immutable before update or delete on public.podo_encounters for each row execute function public.podo_no_rewrite();
create trigger podo_audit_immutable before update or delete on public.podo_audit for each row execute function public.podo_no_rewrite();
-- Brak bezpośrednich odczytów/zapisów z przeglądarki. API weryfikuje JWT i członkostwo.
do $$ declare t text; begin
 foreach t in array array['podo_admins','podo_patients','podo_services','podo_settings','podo_appointments','podo_encounters','podo_ideas','podo_audit','podo_mail'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.podo_audit_id_seq to service_role;
create function public.podo_action(p_action text,p_data jsonb,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 v_id uuid; p podo_patients; s podo_services; a podo_appointments; conf jsonb;
 st timestamptz; en timestamptz; local_st timestamp; local_en timestamp;
begin
 if not exists(select 1 from podo_admins where user_id=p_actor) then raise exception 'Brak uprawnień'; end if;
 v_id:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
 if p_action='patient' then
  if nullif(p_data->>'birth_date','')::date>current_date then raise exception 'Nieprawidłowa data urodzenia';end if;
  insert into podo_patients(id,name,email,phone,birth_date,profile) values(v_id,trim(p_data->>'name'),coalesce(p_data->>'email',''),coalesce(p_data->>'phone',''),nullif(p_data->>'birth_date','')::date,coalesce(p_data->'profile','{}'))
  on conflict(id) do update set name=excluded.name,email=excluded.email,phone=excluded.phone,birth_date=excluded.birth_date,profile=excluded.profile,updated_at=now();
 elsif p_action='book' then
  -- Jedna osoba / jeden gabinet: blokada transakcyjna chroni przed równoczesnym zapisem.
  perform pg_advisory_xact_lock(9282026);
  if exists(select 1 from podo_appointments where id=v_id) then return jsonb_build_object('id',v_id,'reused',true);end if;
  select * into strict p from podo_patients where id=(p_data->>'patient_id')::uuid;
  select * into strict s from podo_services where id=p_data->>'service_id' and active;
  select data into conf from podo_settings where id='clinic';
  st:=(p_data->>'starts_at')::timestamptz;en:=(p_data->>'ends_at')::timestamptz;
  local_st:=st at time zone 'Europe/Warsaw';local_en:=en at time zone 'Europe/Warsaw';
  if st is null or en is null or st<=now() or en<=st or local_st::date<>local_en::date or local_st::time<'08:00' or local_en::time>'20:00'
   or extract(minute from local_st)::int%30<>0 or extract(minute from local_en)::int%30<>0 or extract(second from local_st)<>0 or extract(second from local_en)<>0 then raise exception 'Nieprawidłowy zakres godzin';end if;
  if exists(select 1 from podo_appointments where status<>'cancelled' and starts_at<en and ends_at>st) then raise exception 'Ten zakres jest już zajęty';end if;
  insert into podo_appointments(id,patient_id,service_id,starts_at,ends_at,patient_name,patient_email,service_name,price,clinic_name,clinic_address,note)
   values(v_id,p.id,s.id,st,en,p.name,p.email,s.name,s.price,conf->>'name',conf->>'address',coalesce(p_data->>'note',''));
  if p.email<>'' then
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
 elsif p_action='encounter' then
  if exists(select 1 from podo_encounters where id=v_id) then return jsonb_build_object('id',v_id,'reused',true);end if;
  select * into strict p from podo_patients where id=(p_data->>'patient_id')::uuid for share;
  if nullif(p_data->>'appointment_id','') is not null then
   select * into strict a from podo_appointments where id=(p_data->>'appointment_id')::uuid and patient_id=p.id for update;
   if a.status<>'confirmed' then raise exception 'Wizyta nie jest aktywna';end if;
   update podo_appointments set status='completed' where id=a.id;
   update podo_mail set state='cancelled' where appointment_id=a.id and kind='reminder' and state in('pending','leased');
  end if;
  if nullif(p_data->>'amends_id','') is not null and not exists(select 1 from podo_encounters where id=(p_data->>'amends_id')::uuid and patient_id=p.id) then raise exception 'Nieprawidłowe uzupełnienie';end if;
  insert into podo_encounters(id,patient_id,appointment_id,amends_id,created_by,observations,performed,aftercare,products,zones,pain,followup_date,profile_snapshot,amount,paid)
   values(v_id,p.id,nullif(p_data->>'appointment_id','')::uuid,nullif(p_data->>'amends_id','')::uuid,p_actor,p_data->>'observations',p_data->>'performed',p_data->>'aftercare',coalesce(p_data->>'products',''),coalesce(p_data->'zones','[]'),nullif(p_data->>'pain','')::int,nullif(p_data->>'followup_date','')::date,p.profile,coalesce((p_data->>'amount')::int,0),coalesce((p_data->>'paid')::boolean,false));
 elsif p_action='idea' then
  if length(trim(coalesce(p_data->>'title','')))=0 or length(trim(coalesce(p_data->>'content','')))=0 then raise exception 'Pusty pomysł';end if;
  insert into podo_ideas(id,title,content,category,created_by) values(v_id,p_data->>'title',p_data->>'content',coalesce(p_data->>'category','Pomysł'),p_actor) on conflict(id) do nothing;
 elsif p_action='service' then
  insert into podo_services(id,name,category,minutes,price,active) values(p_data->>'service_id',p_data->>'name',p_data->>'category',(p_data->>'minutes')::int,(p_data->>'price')::int,true)
   on conflict(id) do update set name=excluded.name,category=excluded.category,minutes=excluded.minutes,price=excluded.price;
 elsif p_action='settings' then
  if length(trim(coalesce(p_data->>'name','')))=0 then raise exception 'Podaj nazwę gabinetu';end if;
  update podo_settings set data=p_data where id='clinic';
 else raise exception 'Nieznana czynność';end if;
 insert into podo_audit(actor,action,entity_id) values(p_actor,p_action,coalesce(p_data->>'service_id',v_id::text));
 return jsonb_build_object('id',v_id);
end $$;
revoke all on function public.podo_action(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.podo_action(text,jsonb,uuid) to service_role;
create function public.podo_claim_mail() returns setof podo_mail language plpgsql security definer set search_path=public as $$
begin
 update podo_mail set state='failed',last_error='Wymagana kontrola: przekroczono okno ponowienia.' where state in('pending','leased') and first_attempt_at<now()-interval '23 hours';
 return query update podo_mail set state='leased',lease_until=now()+interval '3 minutes',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now())
 where id in(select id from podo_mail where due_at<=now() and (state='pending' or (state='leased' and lease_until<now())) order by due_at for update skip locked limit 15) returning *;
end $$;
revoke all on function public.podo_claim_mail() from public,anon,authenticated;
grant execute on function public.podo_claim_mail() to service_role;
-- Po utworzeniu użytkownika w Authentication / Users:
-- insert into public.podo_admins(user_id) values ('UUID-UŻYTKOWNIKA');


-- 002_patient_photos.sql
-- Uruchomić po 001_podocare.sql. Zdjęcia wyłącznie w prywatnym bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('podo-patient-photos','podo-patient-photos',false,2097152,array['image/jpeg']);
create table public.podo_photos (
 id uuid primary key, patient_id uuid not null references public.podo_patients(id),
 created_at timestamptz not null default now(), created_by uuid not null references auth.users(id),
 storage_path text not null unique, sha256 text not null check(length(sha256)=64),
 width integer not null check(width>0),height integer not null check(height>0)
);
create index on public.podo_photos(patient_id,created_at);
alter table public.podo_photos enable row level security;
revoke all on public.podo_photos from anon,authenticated;
grant all on public.podo_photos to service_role;
-- Brak policies dla anon/authenticated w Storage; odczyt tylko przez autoryzowane API.
create function public.podo_add_photo(p_data jsonb,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_id uuid:=(p_data->>'id')::uuid; pid uuid:=(p_data->>'patient_id')::uuid; old podo_photos;
begin
 if not exists(select 1 from podo_admins where user_id=p_actor) then raise exception 'Brak uprawnień';end if;
 if not exists(select 1 from podo_patients where id=pid) then raise exception 'Nie znaleziono pacjenta';end if;
 if p_data->>'storage_path'<>pid::text||'/'||v_id::text||'.jpg' then raise exception 'Nieprawidłowa ścieżka zdjęcia';end if;
 select * into old from podo_photos where id=v_id;
 if found then
  if old.patient_id<>pid or old.sha256<>p_data->>'sha256' then raise exception 'Konflikt identyfikatora zdjęcia';end if;
  return jsonb_build_object('id',v_id,'reused',true);
 end if;
 insert into podo_photos(id,patient_id,created_by,storage_path,sha256,width,height)
 values(v_id,pid,p_actor,p_data->>'storage_path',p_data->>'sha256',(p_data->>'width')::int,(p_data->>'height')::int);
 insert into podo_audit(actor,action,entity_id) values(p_actor,'photo',v_id::text);
 return jsonb_build_object('id',v_id);
end $$;
revoke all on function public.podo_add_photo(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.podo_add_photo(jsonb,uuid) to service_role;


-- 003_staff_clinic.sql
-- Po 001 i 002. Rozszerzenia panelu personelu. Bez publicznego panelu rezerwacji.
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


-- 004_clinic_setup.sql
-- Jednorazowa konfiguracja NOWEGO, pustego gabinetu po 001–003.
-- Nie uruchamiaj ponownie: nie nadpisujemy uzgodnionego cennika ani ustawień.
do $$ begin
 if exists(select 1 from public.podo_patients) or exists(select 1 from public.podo_appointments)
  or exists(select 1 from public.podo_audit) or (select data->>'name' from public.podo_settings where id='clinic') is distinct from 'PodoCare'
 then raise exception 'Konfiguracja startowa wymaga pustej, nowej bazy PodoCare. Nie zmieniono danych.'; end if;
end $$;
update public.podo_settings set data='{"name":"Podo-Profilaktyka","practitioner":"Katarzyna Kosak","greeting":"Miło Cię widzieć","address":"Orląt Lwowskich 72K, 25-437 Kielce","phone":"+48 664 010 384","email":"podo-profilaktyka@onet.eu","website":"https://podologkielce.com.pl/","logo":"assets/podo-profilaktyka-logo.png","priceSource":"https://podologkielce.com.pl/cennik-podolog-kielce-gabinet-podologiczny-kielce-podo-profilaktyka/","checked":"2026-09-28","hours":"Pon.–pt. 08:00–20:00 · sob.–niedz. 15:00–20:00 (do potwierdzenia)","reminders":true}'::jsonb where id='clinic';
insert into public.podo_services(id,name,category,minutes,price,price_max,price_note,time_confirmed) values
 ('consult','Konsultacja podologiczna','Konsultacje',30,7000,7000,'Bezpłatna w ramach zabiegu',false),
 ('check','Kontrolna wizyta podologiczna','Konsultacje',30,7000,7000,'',false),
 ('mycology','Pobranie próbki z paznokcia — badanie mykologiczne','Badania',30,16000,16000,'',false),
 ('basic','Podstawowy zabieg podologiczny','Zabiegi podstawowe',60,16000,16000,'',false),
 ('special','Specjalistyczny zabieg podologiczny','Zabiegi podstawowe',60,18000,20000,'Zakres do ustalenia podczas wizyty',false),
 ('cosmetic','Podstawowy zabieg kosmetyczny','Zabiegi podstawowe',60,15000,15000,'',false),
 ('diabetic','Pielęgnacja stopy cukrzycowej','Zabiegi podstawowe',60,15000,18000,'Po indywidualnej kwalifikacji',false),
 ('callus','Usunięcie modzela','Zmiany skórne',30,8000,8000,'Do dwóch zmian',false),
 ('callus-many','Usunięcie modzeli — powyżej dwóch','Zmiany skórne',60,11000,11000,'',false),
 ('corn','Usunięcie odcisku','Zmiany skórne',30,9000,9000,'Bez odciążenia',false),
 ('corn-relief','Usunięcie odcisku z odciążeniem','Zmiany skórne',30,12000,12000,'',false),
 ('corn-many','Usunięcie odcisków — powyżej dwóch','Zmiany skórne',60,15000,15000,'',false),
 ('heel','Opracowanie pękających pięt','Zmiany skórne',60,16000,16000,'',false),
 ('nail-cut','Obcięcie płytki paznokciowej','Paznokcie',30,4000,4000,'',false),
 ('nail-fold','Obcięcie paznokci i opracowanie wałów','Paznokcie',30,6000,8000,'',false),
 ('nails','Oczyszczenie płytki zmienionej chorobowo','Paznokcie',60,15000,22000,'',false),
 ('onycholysis','Terapia onycholizy — jeden paznokieć','Paznokcie',30,10000,10000,'',false),
 ('onycholysis-two','Terapia onycholizy — dwa paznokcie','Paznokcie',60,18000,18000,'',false),
 ('reconstruction','Rekonstrukcja płytki — jeden paznokieć','Paznokcie',30,9000,9000,'',false),
 ('reconstruction-remove','Usunięcie masy rekonstrukcyjnej','Paznokcie',30,5000,5000,'',false),
 ('hematoma','Ewakuacja krwiaka podpaznokciowego','Paznokcie',30,8000,10000,'Wskazany na stronie zakres: do 48 h; wymaga kwalifikacji',false),
 ('relief','Odciążenie','Odciążenia i opatrunki',30,3000,6000,'',false),
 ('dressing','Opatrunek z preparatem','Odciążenia i opatrunki',30,4000,8000,'',false),
 ('heel-dressing','Terapia pięt z odciążeniem i opatrunkiem','Odciążenia i opatrunki',60,18000,20000,'',false),
 ('wart','Usunięcie brodawki wirusowej','Terapie specjalistyczne',30,10000,10000,'Odciążenie dodatkowo 20 zł',false),
 ('warts','Usunięcie brodawek mnogich','Terapie specjalistyczne',60,15000,20000,'',false),
 ('ingrown','Opracowanie wrastającego paznokcia + opatrunek','Terapie specjalistyczne',60,10000,16000,'Jeden / dwa palce',false),
 ('ingrown-check','Kontrola wrastającego paznokcia / zmiana opatrunku','Terapie specjalistyczne',30,9000,9000,'',false),
 ('tamponade','Aplikacja tamponady','Terapie specjalistyczne',30,3000,null,'Cena od 30 zł',false),
 ('brace','Założenie klamry tytanowej / Frasera','Klamry',60,17000,22000,'',false),
 ('brace-check','Przełożenie klamry drutowej','Klamry',30,9000,9000,'',false),
 ('onyclip','Założenie klamry OnyClip','Klamry',30,12000,12000,'',false),
 ('combiped','Założenie klamry Combi-ped / Podofix','Klamry',30,12000,14000,'',false),
 ('taping','Taping podologiczny','Dodatkowe',30,6000,8000,'',false),
 ('orthosis','Ortozy indywidualne','Dodatkowe',30,5000,9000,'',false),
 ('lymph','Drenaż limfatyczny kończyn dolnych','Dodatkowe',30,4000,4000,'30 minut podane w cenniku',true),
 ('massage','Masaż podologiczny kończyny dolnej','Dodatkowe',30,5000,5000,'Cena za jedną nogę',false)
on conflict(id) do update set name=excluded.name,category=excluded.category,minutes=excluded.minutes,price=excluded.price,price_max=excluded.price_max,price_note=excluded.price_note,time_confirmed=excluded.time_confirmed;


-- 005_simple_visit_workflow.sql
-- Prosty przeplyw pracy podczas wizyty. Migracja jest niedestrukcyjna:
-- nie usuwa ani nie przepisuje istniejacych wizyt, zdjec i dokumentacji.

alter table public.podo_appointments add column case_id uuid;
alter table public.podo_appointments add column zones jsonb not null default '[]'::jsonb;
alter table public.podo_appointments add column live_notes text not null default '';
alter table public.podo_appointments add constraint podo_appointment_zones_array check(jsonb_typeof(zones)='array');
alter table public.podo_appointments add constraint podo_appointment_patient_unique unique(id,patient_id);
alter table public.podo_appointments add constraint podo_appointment_case_patient foreign key(case_id,patient_id) references public.podo_cases(id,patient_id);

alter table public.podo_photos add column appointment_id uuid;
alter table public.podo_photos add constraint podo_photo_appointment_patient foreign key(appointment_id,patient_id) references public.podo_appointments(id,patient_id);
create index podo_photos_appointment_idx on public.podo_photos(appointment_id);

create or replace function public.podo_book(p_data jsonb,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 v_id uuid:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());
 p podo_patients; s podo_services; a podo_appointments; conf jsonb; contact jsonb;
 cid uuid:=nullif(p_data->>'case_id','')::uuid; agreed_price integer;
 visit_zones jsonb:=coalesce(p_data->'zones','[]'::jsonb);
 st timestamptz; en timestamptz; local_st timestamp; local_en timestamp;
begin
 if not exists(select 1 from podo_admins where user_id=p_actor) then raise exception 'Brak uprawnień'; end if;
 perform pg_advisory_xact_lock(9282026);
 select * into a from podo_appointments where id=v_id;
 if found then
  if a.patient_id is distinct from (p_data->>'patient_id')::uuid
   or a.service_id is distinct from p_data->>'service_id'
   or a.starts_at is distinct from (p_data->>'starts_at')::timestamptz
   or a.ends_at is distinct from (p_data->>'ends_at')::timestamptz
   or a.case_id is distinct from cid or a.zones is distinct from visit_zones
   or (p_data ? 'price' and a.price is distinct from (p_data->>'price')::integer)
  then raise exception 'Konflikt identyfikatora wizyty'; end if;
  return jsonb_build_object('id',v_id,'reused',true);
 end if;
 select * into strict p from podo_patients where id=(p_data->>'patient_id')::uuid for share;
 select * into strict s from podo_services where id=p_data->>'service_id' and active;
 if cid is not null and not exists(select 1 from podo_cases where id=cid and patient_id=p.id) then raise exception 'Problem musi należeć do tego pacjenta'; end if;
 if jsonb_typeof(visit_zones)<>'array' or jsonb_array_length(visit_zones)>1
  or exists(select 1 from jsonb_array_elements_text(visit_zones) z where length(z)>100)
 then raise exception 'Wybierz najwyżej jeden obszar stopy'; end if;
 select data into conf from podo_settings where id='clinic';
 contact:=podo_contact(p.birth_date,p.profile,p.name,p.email,p.phone);
 agreed_price:=coalesce((p_data->>'price')::integer,s.price);
 if agreed_price<0 or agreed_price>10000000 then raise exception 'Nieprawidłowa cena wizyty'; end if;
 st:=(p_data->>'starts_at')::timestamptz;en:=(p_data->>'ends_at')::timestamptz;
 local_st:=st at time zone 'Europe/Warsaw';local_en:=en at time zone 'Europe/Warsaw';
 if st is null or en is null or st<=now() or en<=st or local_st::date<>local_en::date or local_st::time<'08:00' or local_en::time>'20:00'
  or extract(minute from local_st)::int%30<>0 or extract(minute from local_en)::int%30<>0 or extract(second from local_st)<>0 or extract(second from local_en)<>0
 then raise exception 'Nieprawidłowy zakres godzin'; end if;
 if exists(select 1 from podo_appointments where status<>'cancelled' and starts_at<en and ends_at>st) then raise exception 'Ten zakres jest już zajęty'; end if;
 insert into podo_appointments(id,patient_id,service_id,starts_at,ends_at,patient_name,patient_email,service_name,price,clinic_name,clinic_address,note,contact_snapshot,case_id,zones)
 values(v_id,p.id,s.id,st,en,p.name,contact->>'email',s.name,agreed_price,conf->>'name',coalesce(conf->>'address',''),coalesce(p_data->>'note',''),contact,cid,visit_zones);
 if contact->>'email'<>'' then
  insert into podo_mail(appointment_id,kind,due_at) values(v_id,'confirmed',now());
  if coalesce((conf->>'reminders')::boolean,true) and st-interval '24 hours'>now() then insert into podo_mail(appointment_id,kind,due_at) values(v_id,'reminder',st-interval '24 hours'); end if;
 end if;
 insert into podo_audit(actor,action,entity_id) values(p_actor,'book',v_id::text);
 return jsonb_build_object('id',v_id);
end $$;
revoke all on function public.podo_book(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.podo_book(jsonb,uuid) to service_role;

create or replace function public.podo_reschedule(p_data jsonb,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 v_id uuid:=(p_data->>'id')::uuid; a podo_appointments; conf jsonb;
 st timestamptz:=(p_data->>'starts_at')::timestamptz; en timestamptz:=(p_data->>'ends_at')::timestamptz;
 local_st timestamp:=st at time zone 'Europe/Warsaw'; local_en timestamp:=en at time zone 'Europe/Warsaw';
begin
 if not exists(select 1 from podo_admins where user_id=p_actor) then raise exception 'Brak uprawnień'; end if;
 perform pg_advisory_xact_lock(9282026);
 select * into strict a from podo_appointments where id=v_id for update;
 if a.status<>'confirmed' then raise exception 'Można przesunąć tylko aktywną wizytę'; end if;
 if a.starts_at=st and a.ends_at=en then return jsonb_build_object('id',v_id,'reused',true); end if;
 if st is null or en is null or en<=st or local_st::date<(now() at time zone 'Europe/Warsaw')::date
  or local_st::date<>local_en::date or local_st::time<'08:00' or local_en::time>'20:00'
  or extract(minute from local_st)::int%30<>0 or extract(minute from local_en)::int%30<>0 or extract(second from local_st)<>0 or extract(second from local_en)<>0
 then raise exception 'Nieprawidłowy zakres godzin'; end if;
 if exists(select 1 from podo_appointments where id<>v_id and status<>'cancelled' and starts_at<en and ends_at>st) then raise exception 'Ten zakres jest już zajęty'; end if;
 update podo_appointments set starts_at=st,ends_at=en,revision=revision+1 where id=v_id;
 select data into conf from podo_settings where id='clinic';
 update podo_mail set due_at=st-interval '24 hours',state=case when st-interval '24 hours'>now() then 'pending' else 'cancelled' end,
  attempts=0,lease_until=null,first_attempt_at=null,last_error=null
 where appointment_id=v_id and kind='reminder' and state<>'sent';
 if not found and a.patient_email<>'' and coalesce((conf->>'reminders')::boolean,true) and st-interval '24 hours'>now() then
  insert into podo_mail(appointment_id,kind,due_at) values(v_id,'reminder',st-interval '24 hours') on conflict(appointment_id,kind) do nothing;
 end if;
 insert into podo_audit(actor,action,entity_id) values(p_actor,'reschedule',v_id::text);
 return jsonb_build_object('id',v_id);
end $$;
revoke all on function public.podo_reschedule(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.podo_reschedule(jsonb,uuid) to service_role;

create or replace function public.podo_visit_note(p_data jsonb,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_id uuid:=(p_data->>'id')::uuid; note_value text:=trim(coalesce(p_data->>'live_notes',''));
begin
 if not exists(select 1 from podo_admins where user_id=p_actor) then raise exception 'Brak uprawnień'; end if;
 if length(note_value)>6000 then raise exception 'Notatka jest zbyt długa'; end if;
 if not exists(select 1 from podo_appointments where id=v_id and status='confirmed') then raise exception 'Wizyta nie jest aktywna'; end if;
 update podo_appointments set live_notes=note_value where id=v_id;
 insert into podo_audit(actor,action,entity_id) values(p_actor,'visit-note',v_id::text);
 return jsonb_build_object('id',v_id);
end $$;
revoke all on function public.podo_visit_note(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.podo_visit_note(jsonb,uuid) to service_role;

create or replace function public.podo_add_photo(p_data jsonb,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 v_id uuid:=(p_data->>'id')::uuid; pid uuid:=(p_data->>'patient_id')::uuid; old podo_photos;
 cid uuid:=nullif(p_data->>'case_id','')::uuid; eid uuid:=nullif(p_data->>'encounter_id','')::uuid; aid uuid:=nullif(p_data->>'appointment_id','')::uuid;
 phase_value text:=coalesce(p_data->>'phase','control'); date_value date:=coalesce(nullif(p_data->>'taken_on','')::date,(now() at time zone 'Europe/Warsaw')::date);
 appointment_case uuid; encounter_case uuid; encounter_appointment uuid;
begin
 if not exists(select 1 from podo_admins where user_id=p_actor) then raise exception 'Brak uprawnień'; end if;
 if not exists(select 1 from podo_patients where id=pid) then raise exception 'Nie znaleziono pacjenta'; end if;
 if p_data->>'storage_path' is distinct from pid::text||'/'||v_id::text||'.jpg' then raise exception 'Nieprawidłowa ścieżka zdjęcia'; end if;
 if date_value>(now() at time zone 'Europe/Warsaw')::date or phase_value not in ('before','control','after') then raise exception 'Sprawdź datę i etap zdjęcia'; end if;
 if cid is not null and not exists(select 1 from podo_cases where id=cid and patient_id=pid) then raise exception 'Problem musi należeć do tego pacjenta'; end if;
 if aid is not null then
  select case_id into appointment_case from podo_appointments where id=aid and patient_id=pid;
  if not found then raise exception 'Wizyta dotyczy innego pacjenta'; end if;
  if appointment_case is not null and appointment_case is distinct from cid then raise exception 'Zdjęcie wskazuje inny problem niż wizyta'; end if;
 end if;
 if eid is not null then
  select case_id,appointment_id into encounter_case,encounter_appointment from podo_encounters where id=eid and patient_id=pid;
  if not found or encounter_case is distinct from cid then raise exception 'Dokumentacja dotyczy innego pacjenta lub problemu'; end if;
  if aid is not null and encounter_appointment is not null and encounter_appointment<>aid then raise exception 'Zdjęcie wskazuje inną wizytę niż dokumentacja'; end if;
  aid:=coalesce(aid,encounter_appointment);
 end if;
 select * into old from podo_photos where id=v_id;
 if found then
  if old.patient_id is distinct from pid or old.sha256 is distinct from p_data->>'sha256' or old.case_id is distinct from cid
   or old.encounter_id is distinct from eid or old.appointment_id is distinct from aid or old.phase is distinct from phase_value
   or coalesce(old.taken_on,(old.created_at at time zone 'Europe/Warsaw')::date) is distinct from date_value
  then raise exception 'Konflikt identyfikatora zdjęcia'; end if;
  return jsonb_build_object('id',v_id,'reused',true);
 end if;
 insert into podo_photos(id,patient_id,created_by,storage_path,sha256,width,height,case_id,encounter_id,appointment_id,phase,taken_on)
 values(v_id,pid,p_actor,p_data->>'storage_path',p_data->>'sha256',(p_data->>'width')::int,(p_data->>'height')::int,cid,eid,aid,phase_value,date_value);
 insert into podo_audit(actor,action,entity_id) values(p_actor,'photo',v_id::text);
 return jsonb_build_object('id',v_id);
end $$;
revoke all on function public.podo_add_photo(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.podo_add_photo(jsonb,uuid) to service_role;


commit;
