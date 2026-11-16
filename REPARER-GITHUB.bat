@echo off
chcp 65001 >nul
title unidev - Reparer la liaison avec GitHub
cd /d "%~dp0"
echo.
echo  ==========================================
echo     unidev - Reparer la liaison avec GitHub
echo  ==========================================
echo.
echo  A utiliser quand GitHub Desktop dit « unrelated histories » ou refuse d'envoyer.
echo  La version de CE PC devient celle de GitHub. L'ancienne version de GitHub
echo  est gardee dans la branche « copie-github » (rien n'est perdu).
echo.
set /p OK= Continuer ? (o/n) : 
if /i not "%OK%"=="o" exit /b

set "GIT=git"
where git >nul 2>nul
if errorlevel 1 (
  set "GIT="
  for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"
)
if not defined GIT ( echo  Git est introuvable. Ouvre GitHub Desktop une fois puis relance. & pause & exit /b )

"%GIT%" rebase --abort >nul 2>nul
"%GIT%" merge --abort >nul 2>nul

echo  1/4 Enregistrement des fichiers de ce PC...
"%GIT%" add -A
"%GIT%" diff --cached --quiet || "%GIT%" commit -q -m "Mise a jour du %date%"

rem Le dossier doit etre relie au depot unidev (et pas a un autre, comme unidev-robot)
"%GIT%" remote set-url origin https://github.com/asdeyjunior-cmd/unidev.git 2>nul || "%GIT%" remote add origin https://github.com/asdeyjunior-cmd/unidev.git
echo  Dossier relie a : https://github.com/asdeyjunior-cmd/unidev

echo  2/4 Recuperation de la version de GitHub...
"%GIT%" fetch origin
if errorlevel 1 ( echo  Impossible de joindre GitHub. Verifie internet et relance. & pause & exit /b )

rem Si les deux versions se raccordent normalement, pas besoin de forcer
"%GIT%" pull --rebase --autostash origin main >nul 2>nul
if not errorlevel 1 (
  "%GIT%" push origin HEAD:main
  if not errorlevel 1 (
    "%GIT%" branch --set-upstream-to=origin/main >nul 2>nul
    echo.
    echo  Termine : ce PC et GitHub sont a jour, sans rien forcer.
    echo  Pour les prochaines fois, utilise ENVOYER.bat.
    pause & exit /b
  )
)
"%GIT%" rebase --abort >nul 2>nul

echo  3/4 Copie de securite de la version de GitHub (branche copie-github)...
"%GIT%" branch -f copie-github origin/main >nul 2>nul
"%GIT%" push -q -f origin copie-github >nul 2>nul

echo  4/4 Envoi de la version de ce PC...
"%GIT%" push --force origin HEAD:main
if errorlevel 1 (
  echo.
  echo  L'envoi a ete refuse. Envoie une capture de cette fenetre a Claude.
  pause & exit /b
)
"%GIT%" branch --set-upstream-to=origin/main >nul 2>nul
echo.
echo  Termine : GitHub a maintenant la version de ce PC.
echo  Pour les prochaines fois, utilise ENVOYER.bat.
pause
