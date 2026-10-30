@echo off
chcp 65001 >nul
title unidev - Nettoyer Cloudinary
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 ( echo  Node.js n'est pas installe : https://nodejs.org & pause & exit /b )
if not exist node_modules\pdfjs-dist ( echo  Installation des composants... & call npm install --silent )
if not exist cle-firebase.json ( echo  cle-firebase.json introuvable dans ce dossier. & pause & exit /b )
echo.
echo  Recherche des fichiers Cloudinary qui ne servent plus ^(rien n'est supprime pour l'instant^)...
echo.
call node nettoyer.js --essai
echo.
set /p OK=  Supprimer ces fichiers de Cloudinary (O/N) :
if /i not "%OK%"=="O" ( echo  Annule. & pause & exit /b )
call node nettoyer.js
echo.
pause
