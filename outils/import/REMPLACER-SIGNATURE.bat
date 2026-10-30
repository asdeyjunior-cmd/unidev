@echo off
chcp 65001 >nul
title unidev - Remplacer la signature d'un site
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 ( echo  Node.js n'est pas installe : https://nodejs.org & pause & exit /b )
if not exist node_modules\pdfjs-dist ( echo  Installation des composants... & call npm install --silent )
if not exist cle-firebase.json ( echo  cle-firebase.json introuvable dans ce dossier. & pause & exit /b )
echo.
echo  Remplace la signature d'un site partenaire par celle d'unidev
echo  dans les documents de ce site DEJA publies sur unidev.
echo.
set /p ACCORD=  As-tu l'accord ECRIT du site pour remplacer sa signature (O/N) :
if /i not "%ACCORD%"=="O" ( echo  Annule. & pause & exit /b )
set /p SITE=  Nom du site ^(ex : fomesoutra^) :
set /p REMP=  Mots a remplacer, separes par des virgules ^(ex : fomesoutra,fo me soutra^) :
echo.
echo  ---- Verification ^(rien n'est modifie^) ----
call node signature.js --site "%SITE%" --remplacer "%REMP%" --essai
echo.
set /p OK=  Remplacer la signature dans ces documents (O/N) :
if /i not "%OK%"=="O" ( echo  Annule. & pause & exit /b )
call node signature.js --site "%SITE%" --remplacer "%REMP%"
echo.
pause
