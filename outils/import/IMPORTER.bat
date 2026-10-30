@echo off
chcp 65001 >nul
title unidev - Importer des documents
cd /d "%~dp0"

echo.
echo  ==========================================
echo     unidev - Importer des documents
echo  ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js n'est pas installe.
  echo  Installe-le depuis https://nodejs.org ^(bouton LTS^), puis relance ce fichier.
  start https://nodejs.org
  pause
  exit /b
)

if not exist node_modules\pdfjs-dist (
  echo  Premiere utilisation : installation des composants ^(1 a 2 minutes^)...
  call npm install --silent
  if errorlevel 1 ( echo  L'installation a echoue. Verifie ta connexion internet. & pause & exit /b )
)

if not exist .env (
  copy .env.exemple .env >nul
  echo  Le fichier .env vient d'etre cree. Il s'ouvre dans le Bloc-notes :
  echo  remplis CLOUDINARY_API_KEY et CLOUDINARY_API_SECRET, enregistre, puis relance ce fichier.
  notepad .env
  pause
  exit /b
)

if not exist cle-firebase.json (
  echo  Le fichier cle-firebase.json est introuvable dans ce dossier.
  echo  Firebase ^> Parametres du projet ^> Comptes de service ^> Generer une nouvelle cle privee,
  echo  puis renomme le fichier telecharge en cle-firebase.json et place-le ici.
  pause
  exit /b
)

echo  Que veux-tu importer ?
echo    1 - Un dossier de documents de mon ordinateur
echo    2 - Des cours libres depuis HAL ^(archive ouverte^)
echo    3 - Un dossier en vrac ^(export Telegram^) : l'outil le range d'abord et te demande les images
echo    4 - Des cours libres de Wikiversite ^(en francais^)
echo    5 - Des livres de cours libres de Wikilivres ^(en francais^)
echo    6 - Des supports de cours libres de Zenodo
echo    7 - RECHERCHER PARTOUT ^(HAL + Wikiversite + Wikilivres + Zenodo^)
echo    8 - Des ROMANS du domaine public ^(Wikisource : Hugo, Zola, Balzac, Dumas...^)
echo    9 - Les documents d'un SITE qui t'a donne son accord ^(ex : Fomesoutra^)
echo.
set /p CHOIX=  Ton choix (1 a 9) :

if "%CHOIX%"=="2" goto hal
if "%CHOIX%"=="3" goto ranger
if "%CHOIX%"=="4" ( set SRC=wiki --projet wikiversite& goto source )
if "%CHOIX%"=="5" ( set SRC=wiki --projet wikilivres& goto source )
if "%CHOIX%"=="6" ( set SRC=zenodo& goto source )
if "%CHOIX%"=="7" ( set SRC=tout& goto source )
if "%CHOIX%"=="8" ( set SRC=romans& goto source )
if "%CHOIX%"=="9" goto site

echo.
echo  Glisse ton dossier de documents dans cette fenetre, puis appuie sur Entree :
set /p DOSSIER=  Dossier :
set DOSSIER=%DOSSIER:"=%
if not exist "%DOSSIER%" ( echo  Dossier introuvable. & pause & exit /b )

echo.
echo  ---- Verification ^(rien n'est envoye^) ----
call node importer.js dossier "%DOSSIER%" --essai
echo.
set /p OK=  Tout est correct ? Importer pour de vrai (O/N) :
if /i not "%OK%"=="O" ( echo  Annule. Corrige les noms de dossiers ou de fichiers, puis relance. & pause & exit /b )
echo.
call node importer.js dossier "%DOSSIER%"
echo.
pause
exit /b

:hal
echo.
set /p THEME=  Theme a chercher (ex : comptabilite, economie, droit) :
set /p MAX=  Nombre maximum de documents (ex : 50) :
if "%MAX%"=="" set MAX=50
echo.
echo  ---- Verification ^(rien n'est envoye^) ----
call node importer.js hal --recherche "%THEME%" --max %MAX% --essai
echo.
set /p OK=  Importer ces documents pour de vrai (O/N) :
if /i not "%OK%"=="O" ( echo  Annule. & pause & exit /b )
echo.
call node importer.js hal --recherche "%THEME%" --max %MAX%
echo.
pause
exit /b

:ranger
echo.
echo  Glisse le dossier en vrac ^(ex. le dossier de l'export Telegram^) dans cette fenetre, puis Entree :
set /p VRAC=  Dossier :
set VRAC=%VRAC:"=%
if not exist "%VRAC%" ( echo  Dossier introuvable. & pause & exit /b )
echo.
echo  Tes fichiers sont COPIES dans un nouveau dossier "%VRAC%-range" : l'original ne change pas.
echo  Pour chaque document, glisse son image dans la fenetre puis Entree ^(ou juste Entree^).
echo.
call node ranger.js "%VRAC%"
if errorlevel 1 ( pause & exit /b )
echo.
set /p OK=  Verifier le dossier range avant l'import (O/N) :
if /i not "%OK%"=="O" ( echo  Tu pourras l'importer plus tard avec le choix 1. & pause & exit /b )
set DOSSIER=%VRAC%-range
echo.
echo  ---- Verification ^(rien n'est envoye^) ----
call node importer.js dossier "%DOSSIER%" --essai
echo.
set /p OK=  Tout est correct ? Importer pour de vrai (O/N) :
if /i not "%OK%"=="O" ( echo  Annule. Tu peux deplacer des fichiers dans le dossier range, puis choisir 1. & pause & exit /b )
echo.
call node importer.js dossier "%DOSSIER%"
echo.
pause
exit /b

:source
echo.
set THEME=
if "%SRC%"=="romans" ( set /p THEME=  Titre ou auteur ^(ex : Zola, Les Miserables^) - Entree = tous les romans : ) else ( set /p THEME=  Theme a chercher ^(ex : comptabilite, programmation, droit^) : )
if "%SRC%"=="tout" ( set /p MAX=  Nombre maximum de documents PAR SITE ^(ex : 10^) : ) else ( set /p MAX=  Nombre maximum de documents ^(ex : 20^) : )
if "%MAX%"=="" set MAX=20
echo.
echo  ---- Verification ^(rien n'est envoye^) ----
call node importer.js %SRC% --recherche "%THEME%" --max %MAX% --essai
echo.
set /p OK=  Importer ces documents pour de vrai (O/N) :
if /i not "%OK%"=="O" ( echo  Annule. & pause & exit /b )
echo.
call node importer.js %SRC% --recherche "%THEME%" --max %MAX%
echo.
pause
exit /b

:site
echo.
echo  Ouvre le site dans ton navigateur, va sur une page qui liste des documents
echo  ^(ex : les epreuves de BTS^), copie son adresse et colle-la ici ^(clic droit pour coller^).
set /p URL=  Adresse de la page :
set URL=%URL:"=%
echo.
echo    1 - Seulement les documents de cette page
echo    2 - Cette page et ses dossiers
echo    3 - Cette page, ses dossiers et leurs sous-dossiers ^(conseille^)
echo    4 - Encore un niveau de plus
echo  ^(l'outil reste toujours dans le dossier de depart et suit les pages suivantes^)
set /p PROF=  Jusqu'ou chercher (1 a 4, Entree = 3) :
if "%PROF%"=="" set PROF=3
set /p MAX=  Nombre maximum de documents ^(ex : 30^) :
if "%MAX%"=="" set MAX=30
echo.
set /p ACCORD=  Confirmes-tu avoir l'accord ECRIT de ce site pour reprendre ses documents (O/N) :
if /i not "%ACCORD%"=="O" ( echo  Sans accord du site, l'import est annule. & pause & exit /b )
set REMP=
echo.
echo  Le site t'autorise-t-il aussi a remplacer SA signature ^(nom, adresse, liens^) par celle d'unidev dans les PDF ?
set /p SIGN=  (O/N) :
if /i "%SIGN%"=="O" set /p REMP=  Mots a remplacer, separes par des virgules ^(ex : fomesoutra,fo me soutra^) :
echo.
echo  ---- Verification ^(rien n'est envoye^) ----
call node importer.js site --url "%URL%" --profondeur %PROF% --max %MAX% --essai
echo.
set /p OK=  Importer ces documents pour de vrai (O/N) :
if /i not "%OK%"=="O" ( echo  Annule. & pause & exit /b )
echo.
call node importer.js site --url "%URL%" --profondeur %PROF% --max %MAX% --remplacer "%REMP%"
echo.
pause
