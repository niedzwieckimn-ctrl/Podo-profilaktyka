-- Uruchomić po 001_podocare.sql. Zdjęcia wyłącznie w prywatnym bucket.
begin;
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
commit;
