# Weryfikacja wersji 2.1 — 30.09.2026

## Wyniki lokalne

- 60 testów Node.js: wszystkie przeszły. Obejmują domenę, RLS/uprawnienia, czas Warszawy, transakcje, niezmienność historii, zdjęcia, rozszerzenia gabinetu oraz kolejkę poczty.
- Migracje 001–005 przeszły na PostgreSQL PGlite. Schematy Auth/Storage są atrapami otoczenia Supabase, nie chmurą.
- 10 scenariuszy `scripts/staff-browser-qa.mjs`: rzeczywisty UI i kod API z PostgreSQL; logowanie personelu, brak dostępu innego konta, kreator dziecka/opiekuna i szybki zapis, terapia, dokumentacja, zmiana statusu, zdjęcie i pełne powiązania, rezerwacja, widełki cenowe, ponowne logowanie, anulowanie i telefon.
- 14 scenariuszy spersonalizowanego demo i 13 bazowych scenariuszy ogólnego demo ponownie przeszło. W tym aktywna wizyta, wybór trzech osób z kolejki, ukrywana mapa obszaru, kreator jednego etapu na desktopie i telefonie, przeciąganie dotykowe oraz zmiana karty podczas kompresji zdjęcia.
- Brak błędów JavaScript w wymienionych testach. Test personelu i spersonalizowanego demo nie wykonywał zewnętrznych żądań.
- Worker w testach blokuje wysyłkę bez jawnego włączenia / w podglądzie, używa zapisanego odbiorcy i idempotencji oraz odrzuca anulowaną wizytę lub odwołane zadanie.
- Przeglądarka: Edge/Playwright; ekran desktop i mobilny układ 390 px.

## Ważne granice

Auth, Storage i Resend w lokalnych testach są atrapami. Nie wysłano prawdziwego e-maila, nie utworzono konta w chmurze i nie opublikowano aplikacji. Lokalny odczyt zdjęcia po ponownym logowaniu nie potwierdza konfiguracji prawdziwego Supabase.

Nie sprawdzono fizycznego aparatu telefonu, HEIC, instalacji PWA na urządzeniu, dostarczalności poczty ani wyglądu w ciemnym Gmailu. Nie wykonano audytu prawnego, niezależnego audytu bezpieczeństwa i testu obciążeniowego.

Pierwsza budowa Netlify musi potwierdzić instalację zależności oraz pakowanie Functions z natywnym sharp na Linux. Wcześniejsza lokalna próba narzędzi Netlify była blokowana ograniczeniami procesu esbuild na Windows; nie jest to potwierdzenie chmurowego builda.

## Odbiór po wdrożeniu

Wykonaj checklistę w WDROZENIE.md na fikcyjnych danych. Przed realnymi pacjentami sprawdź dostęp, odmowę anonimowego odczytu, zapis i odczyt zdjęć na dwóch urządzeniach, powiadomienia i anulowanie oraz odtworzenie kopii bazy i Storage.
