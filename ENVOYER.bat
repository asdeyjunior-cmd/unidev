@echo off
chcp 65001 >nul
title unidev - Envoyer sur GitHub
cd /d "%~dp0"
echo.
echo  ==========================================
echo     unidev - Envoyer mes changements sur GitHub
echo  ==========================================
echo.

rem --- Trouver Git (celui de Windows, sinon celui fourni avec GitHub Desktop) ---
set "GIT=git"
where git >nul 2>nul
if errorlevel 1 (
  set "GIT="
  for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"
)
if not defined GIT (
  echo  Git est introuvable. Ouvre GitHub Desktop une fois, ou installe Git depuis https://git-scm.com
  pause & exit /b
)

rem Toujours relie au depot unidev
"%GIT%" remote set-url origin https://github.com/asdeyjunior-cmd/unidev.git >nul 2>nul

set "J=outils\import\import-journal.json"
set "JL=%TEMP%\unidev-journal-local.json"

rem --- 1. Mettre de cote le journal d'import de ce PC (le robot GitHub ecrit aussi dedans) ---
if exist "%J%" copy /y "%J%" "%JL%" >nul
"%GIT%" checkout -- "%J%" >nul 2>nul

rem --- 2. Recuperer ce que le robot a envoye entre-temps ---
echo  Recuperation des changements de GitHub...
"%GIT%" pull --rebase --autostash
if errorlevel 1 (
  "%GIT%" rebase --abort >nul 2>nul
  echo.
  echo  La recuperation a echoue. Rien n'a ete perdu. Envoie une capture de cette fenetre a Claude.
  pause & exit /b
)

rem --- 3. Remettre les entrees du journal de ce PC (les deux journaux sont fusionnes) ---
if exist "%JL%" (
  node -e "const fs=require('fs');const a=process.argv[1],b=process.argv[2];let x={},y={};try{x=JSON.parse(fs.readFileSync(a,'utf8'))}catch{};try{y=JSON.parse(fs.readFileSync(b,'utf8'))}catch{};fs.writeFileSync(a,JSON.stringify({...y,...x},null,2))" "%J%" "%JL%" 2>nul
  del /q "%JL%" >nul 2>nul
)

rem --- 4. Enregistrer et envoyer ---
"%GIT%" add -A
"%GIT%" diff --cached --quiet
if errorlevel 1 (
  "%GIT%" commit -q -m "Mise a jour du %date% %time:~0,5%"
) else (
  echo  Aucun changement a envoyer.
)
"%GIT%" push
if errorlevel 1 (
  "%GIT%" pull --rebase --autostash && "%GIT%" push
)
if errorlevel 1 (
  echo.
  echo  L'envoi a echoue. Envoie une capture de cette fenetre a Claude.
  pause & exit /b
)
echo.
echo  Termine : GitHub est a jour. Le site sera mis en ligne dans 2 a 3 minutes.
pause
