-- PodoCare 1.0. Uruchomić w NOWYM projekcie Supabase, nie w bazie Massages.
begin;
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
commit;
-- Po utworzeniu użytkownika w Authentication / Users:
-- insert into public.podo_admins(user_id) values ('UUID-UŻYTKOWNIKA');
