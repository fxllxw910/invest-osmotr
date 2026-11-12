@echo off
cd /d "%~dp0.."
node "scripts\tunnel.js" >> "tunnel.log" 2>&1
