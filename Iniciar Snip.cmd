@echo off
rem Doble clic para arrancar Snip (web + worker) en este PC.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar-snip.ps1" %*
if errorlevel 1 pause
