# Podo-Profilaktyka · panel personelu · wersja 2.0

Paczka źródłowa do nowego repozytorium GitHub i wdrożenia na Netlify z osobnym projektem Supabase oraz Resend. **Nie zawiera panelu pacjenta ani publicznego formularza rezerwacji.** Wizytę tworzy zalogowany pracownik; pacjent lub opiekun może otrzymać powiadomienie e-mail.

To osobna aplikacja. Nie podmieniaj repozytorium, projektu Supabase ani ustawień działającego Massages & SPA.

## Zacznij tutaj

Otwórz **WDROZENIE.md** — instrukcja krok po kroku. W archiwum jest kompletny kod, nie tylko poprawki i nie samo demo.

1. GitHub: cała zawartość rozpakowanego katalogu w głównym katalogu nowego repozytorium, jednym commitem.
2. Supabase: nowy pusty projekt; uruchom `supabase/INSTALL-FRESH.sql` z paczki. Ten plik łączy migracje 001–004 w jedną transakcję. Nie uruchamiaj potem tych samych migracji drugi raz.
3. Utwórz konto personelu w Auth i nadaj dostęp w `podo_admins`; wyłącz publiczną rejestrację.
4. Netlify: import nowego repozytorium, zmienne według WDROZENIE.md. Resend: domena nadawcy i klucz.
5. Sprawdź całość na fikcyjnych danych i własnym adresie e-mail, zanim zaczniesz prowadzić prawdziwą dokumentację.

Wysyłka jest domyślnie wyłączona. Musi być jawnie włączona zmienną `EMAIL_DELIVERY_ENABLED=true` i pochodzić z budowy produkcyjnej. Oczekujące zadania mogą ruszyć po włączeniu — najpierw przejrzyj kolejkę. Podglądy Deploy Preview mają dodatkową blokadę wysyłki.

## Zakres aplikacji

- Terminarz jednego specjalisty: 08:00–20:00, krok 30 minut, przeciąganie myszką lub palcem tworzy jedną wizytę.
- Dorośli i dzieci: wywiad, alergie, leki, ryzyka podologiczne, obciążenie stóp, komfort i dobrowolna notatka do rozmowy.
- Osobne dane opiekuna. Przy małoletnim kontakt opiekuna nie jest zastępowany adresem dziecka.
- Problemy i terapie: lokalizacja na stopie, kolejne kontrole i historia zmian statusu.
- Dokumentacja wizyty z kopią wywiadu. Bez nadpisywania starych wpisów; błąd wyjaśnia nowe uzupełnienie.
- Prywatne zdjęcia przypisane do pacjenta, problemu, wizyty, etapu i daty. Porównanie dwóch zdjęć tego samego problemu obok siebie, bez analizy AI.
- 37 pozycji i wariantów cennika gabinetu, widełki / cena od, uzgodniona cena konkretnej rezerwacji.
- Rozliczenia pomocnicze wizyt, Pomysły i opcjonalny pisemny Doradca AI.
- E-maile: potwierdzenie, anulowanie, przypomnienie; bez rozpoznań, nazwy zabiegu, notatek i zdjęć.
- Wygląd Podo-Profilaktyki także po prawdziwym zalogowaniu, nie tylko w demo.

Nowe funkcje demo zostały połączone z backendem. Pierwsza instalacja nie dodaje fikcyjnych pacjentów, kont pracowników ani zdjęć przykładowych do bazy. Cennik wymaga zatwierdzenia przez gabinet; czasy większości usług są robocze. Ustawienia danych kontaktowych można zmienić w aplikacji. Harmonogram nadal dopuszcza 08–20 w każdy dzień — godziny i długości wizyt trzeba uzgodnić przed startem.

## Zdjęcia

W karcie pacjenta wybierz problem, ewentualną wizytę, etap i datę, potem „Zrób zdjęcie” lub „Z galerii”. Zatwierdzony plik zapisuje się automatycznie w wybranym wcześniej kontekście, także gdy podczas kompresji otworzysz inną kartę.

Serwer usuwa EXIF i zapisuje JPEG do 1600 px / 2 MB. Oryginał nie jest archiwizowany. Datę wykonania wpisuje personel; data dodania jest zapisywana oddzielnie. Bucket jest prywatny, odczyt po autoryzacji przez URL ważny 90 sekund. Nie udostępniaj tych linków. Zdjęcia nie są wysyłane do AI. Przy błędzie można ponowić zapis, dopóki strona pozostaje otwarta; potwierdzenie pojawia się po zapisaniu metadanych.

Sprawdź fizyczny aparat Android/iPhone przez HTTPS. Test kontrolki i emulacja telefonu nie potwierdzają obsługi każdego urządzenia ani formatu HEIC.

## Dostęp, historia i ograniczenia

Supabase Auth potwierdza tożsamość, a `podo_admins` dostęp do gabinetu. Same konto Auth ani znajomość publicznego klucza nie dają dostępu do kartoteki. Przeglądarka nie ma bezpośrednich praw do tabel. Funkcje wymagają JWT i członkostwa przed użyciem klucza serwerowego. Brak publicznego API zapisującego rezerwacje. Plan przyszłego rozszerzenia: FUTURE-PATIENT-PORTAL.md.

Jedna praktyka, jeden wspólny terminarz i jedna rola personelu. Nie ma importu danych SPA, panelu pacjenta, wielu kalendarzy specjalistów, faktur, magazynu sterylizacji ani automatycznej analizy zdjęć. Rezerwacje odwołuje się przez anulowanie i zwolnienie godzin, nie wymazanie historii.

Sesja pozostaje w pamięci strony; odświeżenie wymaga ponownego logowania. Karty i zdjęcia nie są cacheowane w PWA ani przechowywane w localStorage. Aplikacja wymaga sieci. Telefon może zainstalować PWA pod HTTPS, po sprawdzeniu zachowania docelowej przeglądarki.

Kolejka jest sprawdzana co 10 minut. Przypomnienie planowane jest 24 godziny przed wizytą, o ile przy rezerwacji do tego czasu pozostało więcej niż 24 godziny. Przy rezerwacji późniejszej wysyłane jest tylko potwierdzenie. Awaria może opóźnić wysyłkę. Resend nie przechowuje przyszłych zaplanowanych przypomnień: worker przed wysyłką sprawdza aktualny status wizyty. Wiadomości już wysłanej lub żądania trwającego u dostawcy nie można cofnąć.

## Przed użyciem prawdziwych danych

To nie jest deklaracja gotowości prawnej ani niezależny audyt bezpieczeństwa. Ustal zasady dostępu, przetwarzania danych zdrowotnych, zgód, retencji, korekt, kopii zapasowych i umów z dostawcami. Kopia bazy nie zastępuje kopii plików Storage. Wykonaj próbę odtworzenia obu. Nie zbieraj zbędnych danych ani danych osób postronnych.

AI jest opcjonalne i nie jest wymagane do uruchomienia panelu. Nie skonfigurowano go w chmurze. Bez klucza i modelu nie działa. Przekazanie kontekstu pacjenta wymaga oddzielnego potwierdzenia w UI. Pomijane są pola nazwiska, kontaktu, daty urodzenia, danych opiekuna i notatek relacyjnych, ale tekst swobodny nadal może identyfikować osobę. Nie oznacza to pełnej anonimizacji. AI nie diagnozuje, nie zmienia kartoteki i nie otrzymuje zdjęć. Zapis ogólnego pomysłu wykonuje aplikacja na polecenie i potwierdza dopiero po odpowiedzi bazy.

## Lokalnie

`node scripts/serve.mjs` uruchamia sam interfejs na http://127.0.0.1:4173/?demo=1 . Demo jest fikcyjne, znika po odświeżeniu i niczego nie wysyła. Nie używaj go do prawdziwych danych. Serwer podglądu nie uruchamia Functions.

```text
pnpm install --frozen-lockfile
node --test --test-concurrency=1 tests/*.test.mjs
node scripts/build.mjs
```

Testy UI: `scripts/staff-browser-qa.mjs` (UI + API + PostgreSQL lokalnie), `scripts/clinic-browser-qa.mjs` i `scripts/browser-qa.mjs` (demo). Wymagają Playwright, zmiennych PLAYWRIGHT_MODULE i opcjonalnie BROWSER_EXE. Szczegóły i granice walidacji: TESTY.md.

## Pochodzenie profilu

Kontakt, logo i cennik sprawdzono 28.09.2026 na publicznej [stronie gabinetu](https://podologkielce.com.pl/) i [cenniku](https://podologkielce.com.pl/cennik-podolog-kielce-gabinet-podologiczny-kielce-podo-profilaktyka/). Bez kopiowania danych rzeczywistych pacjentów. Dwa SVG w demo są schematami, nie zdjęciami klinicznymi.

Bazą przepływów był panel Massages & SPA. Ta kopia nie przenosi kluczy, klientów, starej poczty ani publicznego formularza rezerwacji.
