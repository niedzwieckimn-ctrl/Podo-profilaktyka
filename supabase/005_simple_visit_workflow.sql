-- Prosty przeplyw pracy podczas wizyty. Migracja jest niedestrukcyjna:
-- nie usuwa ani nie przepisuje istniejacych wizyt, zdjec i dokumentacji.
begin;

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
