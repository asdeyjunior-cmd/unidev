@echo off
rem Installe ou repare les composants (node_modules). Appele par les autres fichiers .bat.
if exist node_modules (
  node verifier-composants.mjs >nul 2>nul
  if not errorlevel 1 exit /b 0
  echo  Des composants sont abimes. Reinstallation ^(1 a 3 minutes^)...
  rmdir /s /q node_modules
  if exist package-lock.json del /q package-lock.json
) else (
  echo  Premiere utilisation : installation des composants ^(1 a 3 minutes^)...
)
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo  L'installation a echoue. Verifie ta connexion internet et relance.
  exit /b 1
)
node verifier-composants.mjs
if errorlevel 1 (
  echo  Les composants ne fonctionnent toujours pas avec cette version de Node.js.
  echo  Installe Node.js 22 LTS depuis https://nodejs.org puis relance.
  exit /b 1
)
exit /b 0
