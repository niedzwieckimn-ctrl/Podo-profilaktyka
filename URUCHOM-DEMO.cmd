@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Zainstaluj Node.js 22 lub nowszy, a potem uruchom ten plik ponownie.
  echo https://nodejs.org/
  pause
  exit /b 1
)
echo Otworz w przegladarce: http://127.0.0.1:4173/?demo=1
echo Demo zawiera fikcyjne dane. Nie wprowadzaj prawdziwej dokumentacji.
node scripts/serve.mjs
pause
