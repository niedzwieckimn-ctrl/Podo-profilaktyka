# Furtka na panel pacjenta — bez aktywowania go teraz

Obecna aplikacja jest wyłącznie panelem personelu. Wszystkie odczyty i zapisy danych wymagają sesji Auth oraz członkostwa w `podo_admins`. Nie ma przycisku publicznej rezerwacji, anonimowego RPC rezerwacji, publicznych policies ani kont pacjentów. Konto Auth nie jest automatycznie kartą pacjenta.

Model danych rozdziela pacjenta, rezerwację, dokumentację, terapię, kontakt opiekuna i kolejkę wiadomości. To pozwala dodać samodzielne zgłoszenie rezerwacji bez przepisywania kartoteki. **Nie oznacza, że taka funkcja jest już zaimplementowana.**

Przyszłe rozszerzenie wymaga oddzielnego zakresu:

1. Oddzielny interfejs i endpoint zgłoszenia; nie udostępniać `podo-api` bez sprawdzania pracownika.
2. Jawny wybór modelu: zgłoszenie do akceptacji czy rezerwacja potwierdzana od razu. Osobne reguły wyprzedzenia, wyjątków, ograniczeń i anulowania. Reguł 48 h ze SPA nie przenosimy automatycznie do administracyjnego kalendarza podologa.
3. Transakcyjna kontrola kolizji współdzielona z zapisami personelu; blokada równoległych zapisów i powtórzeń. Ochrona przed nadużyciami i odpowiednie ograniczenie danych wejściowych.
4. Brak automatycznego nadpisywania karty stałego pacjenta po dopasowaniu e-maila. Weryfikacja tożsamości i kontaktu opiekuna jako osobny proces.
5. Pacjent nie może mieć roli `podo_admins`. Domyślnie nie udostępniać mu dokumentacji, zdjęć ani danych innych osób. Jeśli pojawi się dostęp do własnej dokumentacji, wymaga osobnego modelu uprawnień i testów.
6. Migracja addytywna, testy prywatności, zgód i kolejki poczty, uruchomienie dopiero po akceptacji gabinetu.

Nie zostawiono działającej „ukrytej” ścieżki rezerwacji ani zapasowego słabiej chronionego API.
