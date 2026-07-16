@echo off
cd /d "%~dp0"
start "" "http://localhost:8321"
node serve.js
