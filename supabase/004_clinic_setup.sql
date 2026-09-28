-- Jednorazowa konfiguracja NOWEGO, pustego gabinetu po 001–003.
-- Nie uruchamiaj ponownie: nie nadpisujemy uzgodnionego cennika ani ustawień.
begin;
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
commit;
