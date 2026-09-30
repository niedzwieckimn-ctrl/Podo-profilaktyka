# Wdrożenie Podo-Profilaktyki — panel personelu

Ta paczka zastępuje podgląd jako baza do wdrożenia. **Nie jest panelem pacjenta.** Pacjent nie tworzy konta, nie loguje się i nie rezerwuje sam. Wizyty wpisuje personel, a e-mail jest tylko powiadomieniem.

Nie wdrożono niczego automatycznie na Twoich kontach. Potrzebne są trzy oddzielne konfiguracje oraz hosting Netlify. Nie używaj projektu Supabase ani repozytorium Massages & SPA.

## 1. GitHub — jeden nowy projekt

Utwórz nowe, najlepiej prywatne repozytorium, np. `podo-profilaktyka-panel`. Rozpakuj ZIP. Wgraj **zawartość katalogu**, nie plik ZIP i nie sam `dist`. W katalogu głównym repozytorium mają leżeć:

```text
index.html
package.json
pnpm-lock.yaml
netlify.toml
assets/
netlify/functions/       podo-api.js, podo-reminders.js
netlify/lib/             kod pomocniczy, nie osobne endpointy
supabase/
scripts/
tests/
README.md, WDROZENIE.md, TESTY.md
.gitignore, .env.example
```

Wszystkie pliki wgraj w jednym commicie. Najwygodniej najpierw zapełnić repozytorium, a dopiero potem połączyć je z Netlify. Nie rób osobnego commita na każdy folder — po podłączeniu repo każde wypchnięcie może uruchamiać build.

Nie dodawaj `node_modules`, `.env` z wartościami, zrzutów bazy, zdjęć pacjentów ani kluczy. `.env.example` zawiera wyłącznie nazwy zmiennych i bezpieczne wartości startowe.

## 2. Supabase — nowa, pusta baza

1. Utwórz osobny projekt Supabase. Dobierz region i plan do przyjętych zasad przetwarzania danych i kopii zapasowych.
2. W SQL Editor uruchom cały **`supabase/INSTALL-FRESH.sql`** z tej paczki. To jedna transakcja, łącząca migracje 001–005. Nie uruchamiaj potem osobno 001–005. Nie wklejaj tego do bazy SPA.
3. Sprawdź, czy istnieją tabele `podo_patients`, `podo_appointments`, `podo_cases`, `podo_encounters`, `podo_photos` i `podo_mail` oraz prywatny bucket `podo-patient-photos`.
4. W `podo_services` powinno być 37 pozycji. Kartoteka i rezerwacje mają być puste. Pierwsza instalacja nie przenosi pacjentów demo.
5. W ustawieniach Auth wyłącz **Allow new users to sign up** oraz anonimowe logowanie. Panel nie wymaga publicznej rejestracji. [Dokumentacja Auth](https://supabase.com/docs/guides/auth/general-configuration).
6. W Authentication → Users utwórz ręcznie konto pracownika z właściwym e-mailem i silnym hasłem. Do testów użyj własnego konta; nie wpisuj hasła do repozytorium ani do rozmowy. Sprawdź potwierdzenie adresu konta.
7. Skopiuj UUID utworzonego konta i nadaj dostęp w SQL Editor:

```sql
-- Podmień poniższy tekst na UUID konta z Authentication → Users.
insert into public.podo_admins(user_id)
values ('TU-UUID-KONTA-PERSONELU')
on conflict do nothing;
```

Samo konto Auth nie uprawnia do odczytu pacjentów — musi być wpis w `podo_admins`. Każdy pracownik powinien mieć własne konto, aby zapis zachował autora. Nie twórz tu kont pacjentów.

Nie dodawaj publicznych policies do tabel lub Storage. Nie przełączaj bucketa na publiczny. Backend obsługuje dostęp po sprawdzeniu sesji i członkostwa.

Jeżeli baza PodoCare została już wcześniej zainstalowana, **nie uruchamiaj INSTALL-FRESH**. Najpierw ustal zastosowane migracje i wykonaj kopię. Dla schematu 001+002 istnieje migracja rozszerzająca 003; 004 to konfiguracja wyłącznie pustego gabinetu i odmówi nadpisania działających danych. Migracja 005 dodaje aktywną wizytę, powiązanie zdjęcia z rezerwacją oraz bezpieczne przesuwanie terminu — nie usuwa istniejących wpisów. Aktualizacja już używanej bazy wymaga oddzielnej weryfikacji.

## 3. Resend — poczta, bez panelu rezerwacji

Nie wgrywasz tam kodu aplikacji ani HTML ręcznie. Szablony są w `netlify/lib/mail.js` i wysyła je backend Netlify.

1. Dodaj domenę lub subdomenę nadawcy, którą gabinet posiada i której DNS może zmienić. Jeśli masz uprawnienia do `podologkielce.com.pl`, można użyć np. osobnej subdomeny pocztowej. Nie zakładamy, że dostęp do DNS jest już zapewniony.
2. Wprowadź wymagane rekordy DNS pokazane przez Resend i zaczekaj na weryfikację. Nie usuwaj istniejących rekordów poczty Onet ani nie zmieniaj na ślepo MX głównej domeny.
3. Utwórz oddzielny klucz wysyłkowy, najlepiej ograniczony do właściwej domeny.
4. W Netlify wpisz `RESEND_API_KEY` i `FROM_EMAIL`, np. `Podo-Profilaktyka <wizyty@TWOJA-ZWERYFIKOWANA-DOMENA>` — to przykład do zastąpienia, nie gotowy adres.
5. `REPLY_TO_EMAIL` może pozostać `podo-profilaktyka@onet.eu`, aby odpowiedzi wracały na dotychczasową skrzynkę. **Nie ustawiaj adresu Onet jako FROM**, jeśli nie masz uprawnień do domeny nadawcy. Resend wymaga własnej zweryfikowanej domeny. [Weryfikacja domen](https://resend.com/docs/dashboard/domains/introduction), [API wysyłki](https://resend.com/docs/api-reference/emails/send-email).

Nie ma linku „zarezerwuj online”, konta pacjenta ani kopii dokumentacji w e-mailach. Przypomnienia obsługuje własna kolejka, nie harmonogram przyszłych wiadomości w Resend.

## 4. Netlify — aplikacja i dwa procesy serwerowe

Dodaj **nowy** projekt Netlify → import istniejącego repozytorium GitHub. Wybierz nowe repozytorium podologiczne. Nie podmieniaj starego projektu adminmassagesandspa.

- Framework: bez frameworka / Other.
- Base directory: puste, jeśli pliki są w głównym katalogu repo.
- Build command: z `netlify.toml`, czyli `node --test --test-concurrency=1 tests/*.test.mjs && node scripts/build.mjs`.
- Publish directory: `dist`.
- Functions: `netlify/functions`.
- Node: 22, ustawiony w pliku. Zależności instalowane według `pnpm-lock.yaml`.

Nie stosuj Netlify Drop do samego frontendu: do działania tej wersji trzeba zbudować również Functions i zależność `sharp`. SQL nigdy nie trafia do publicznego `dist`.

Przed właściwym deployem dodaj poniższe zmienne w **Netlify → Environment variables**. Jeżeli plan pozwala na zakresy, wybierz Functions. W przeciwnym razie zakres musi obejmować funkcje. Sekrety i dane właściwej bazy ustaw dla kontekstu Production; preview powinien korzystać z oddzielnej bazy testowej albo nie mieć tych kluczy. Nie konfiguruj ich w `netlify.toml`. [Zmienne funkcji](https://docs.netlify.com/build/functions/environment-variables/).

| Zmienna | Wartość | Secret |
|---|---|---|
| `SUPABASE_URL` | URL nowego projektu Supabase | nie |
| `SUPABASE_PUBLISHABLE_KEY` | publiczny klucz publishable; można użyć legacy anon | nie |
| `SUPABASE_SERVICE_ROLE_KEY` | serwerowy legacy klucz `service_role` nowego projektu | **tak** |
| `RESEND_API_KEY` | nowy klucz Resend dla gabinetu | **tak** |
| `FROM_EMAIL` | nazwa i adres z własnej zweryfikowanej domeny | nie |
| `REPLY_TO_EMAIL` | `podo-profilaktyka@onet.eu` lub uzgodniony kontakt | nie |
| `EMAIL_DELIVERY_ENABLED` | początkowo **`false`** | nie |

Klucz publishable / anon jest przeznaczony do logowania w przeglądarce. Nie oznaczaj go jako sekretu. Natomiast `service_role` i klucz Resend nigdy nie mogą trafić do frontendu. Nie wyłączaj całego skanowania sekretów, gdy build zgłosi problem — najpierw sprawdź wskazany klucz.

Nie potrzebujesz kopii zmiennych ze SPA takich jak `PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_SUPABASE_URL`, `THERAPIST_EMAIL` lub `CRON_SECRET`. Ten projekt ma własny zestaw powyżej. Nie ustawiaj ręcznie zastrzeżonego `CONTEXT`: skrypt budowy odczytuje go na Netlify i utrwala blokadę poczty w preview.

Po zmianie wartości Functions wykonaj nowy deploy, żeby zaczęły obowiązywać. Nie uruchamiaj kilku deployów podczas wgrywania pojedynczych plików; najpierw komplet plików i zmiennych, potem jedna budowa. [Netlify: zmienne przy wdrożeniu](https://docs.netlify.com/build/functions/environment-variables/).

### Co ma być widoczne po budowie

W Netlify mają być dokładnie dwa punkty wejścia aplikacji:

- `podo-api` — autoryzowane operacje personelu.
- `podo-reminders` — harmonogram co 10 minut, tylko na opublikowanym deployu. Nie wymaga publicznego linku ani zewnętrznego crona. [Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/).

Pierwszy build potwierdzi pakowanie Functions na Linux. Testy lokalne tego nie zastępują. Sprawdź log budowy i dostępność funkcji, nie tylko zielony widok HTML.

## 5. Próba na fikcyjnych danych

Najlepiej wykonać próbę w oddzielnym projekcie testowym, a bazę właściwego gabinetu rozpocząć pustą. Nie używaj prawdziwych danych pacjentów do testów. Konta, domena, kopie i polityki muszą być sprawdzone przed rozpoczęciem pracy.

1. Otwórz adres Netlify **bez `?demo=1`**. Powinien pojawić się ekran logowania personelu. Sprawdź także telefon przez HTTPS.
2. Zaloguj się kontem obecnym w `podo_admins`. Konto Auth bez członkostwa ma dostać odmowę dostępu. Po wylogowaniu API i zdjęcia nie mogą być odczytywane bez ważnej sesji.
3. Dodaj fikcyjnego pacjenta dorosłego i dziecko z opiekunem. Użyj wyłącznie własnego kontrolowanego e-maila. Dodaj terapię, dokumentację i syntetyczne zdjęcie. Odśwież stronę, zaloguj się ponownie i sprawdź zapis również na drugim urządzeniu.
4. Zmień dane kontaktowe — poprzedni zapis wizyty i kopia wywiadu mają pozostać bez zmian. Sprawdź cennik, cenę konkretnej wizyty i granice 08–20 co 30 min.
5. W Ustawieniach sprawdź kolejkę poczty. Z `EMAIL_DELIVERY_ENABLED=false` nic nie wysyła się do Resend, ale zadania oczekują.
6. **Zanim włączysz pocztę, przejrzyj odbiorców i anuluj niepotrzebne wizyty testowe.** Również anulowania mogą mieć oczekujące wiadomości. Nie używaj cudzych adresów. W nowym projekcie testowym kolejka ma zawierać tylko Twoje testy.
7. Ustaw `EMAIL_DELIVERY_ENABLED=true` dla Production, wykonaj jeden deploy i sprawdź potwierdzenie na własnej skrzynce oraz status w Resend. Pole „Przekazano dostawcy” w aplikacji nie oznacza jeszcze doręczenia.
8. Przypomnienie dla wizyty zaplanowanej z wyprzedzeniem powinno mieć `due_at` 24 godziny przed jej początkiem. Anuluj taką wizytę przed przypomnieniem i sprawdź stan `cancelled` zadania. Prawdziwy test wysyłki przypomnienia wymaga odczekania do terminu; samo utworzenie zadania nie potwierdza dostarczenia.
9. Nie naciskaj wielokrotnie ręcznego uruchomienia workera. Wysłanego e-maila oraz żądania już przekazanego dostawcy nie da się cofnąć. Awaria może opóźnić przypomnienie; nie ma gwarancji co do sekundy.
10. Zweryfikuj prywatność Storage, wygasanie podpisanego adresu zdjęcia, kopię bazy i plików oraz próbę odtworzenia. Dopiero po odbiorze technicznym i uzgodnieniu zasad pracy zacznij prawdziwą kartotekę.

## 6. Co zostawiamy na później

Panel pacjenta może powstać jako oddzielny moduł. Teraz nie ma dla niego kont, routes ani policies. Nie wystarczy udostępnić pacjentowi URL panelu personelu. Plan granic rozszerzenia jest w `FUTURE-PATIENT-PORTAL.md`.

Zmienne środowiskowe, konta, domena nadawcy i hasła nie są zawarte w paczce. Nie wykonano migracji ani deployu na Twoich kontach.
