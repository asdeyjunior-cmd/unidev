@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Pose du logo unidev sur les PDF publies (300 au plus).
node marquer.js --max 300
pause
