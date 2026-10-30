@echo off
chcp 65001 >nul
title unidev - Mettre le site en ligne
cd /d "%~dp0"

echo.
echo  ==========================================
echo     unidev - Mettre le site en ligne
echo  ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 ( echo  Node.js n'est pas installe : https://nodejs.org & pause & exit /b )

cd outils\import
if not exist node_modules (
  echo  Premiere utilisation : installation des composants...
  call npm install --silent
)
if not exist .env ( copy .env.exemple .env >nul )
if not exist cle-firebase.json (
  echo  Le fichier outils\import\cle-firebase.json est introuvable.
  echo  Firebase ^> Parametres du projet ^> Comptes de service ^> Generer une nouvelle cle privee,
  echo  puis renomme-le cle-firebase.json et place-le dans outils\import.
  pause & exit /b
)

echo  1/3 - Creation des pages de documents pour Google...
call node pages.js
if errorlevel 1 ( echo  Erreur pendant la creation des pages. & pause & exit /b )
cd ..\..

echo.
echo  2/3 - Mise en ligne...
call firebase deploy --only hosting
if errorlevel 1 ( echo  La mise en ligne a echoue. & pause & exit /b )

echo.
echo  3/3 - Signalement des pages a Bing...
call node outils\import\indexnow.js
echo.
pause
