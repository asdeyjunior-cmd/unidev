@echo off
chcp 65001 >nul
cd /d "%~dp0"
call composants.bat
if errorlevel 1 ( pause & exit /b )
echo Titres a corriger (essai, rien n est modifie) :
node titres.js --essai
echo.
set /p OK=Corriger ces titres ? (o/n) 
if /i "%OK%"=="o" node titres.js
pause
