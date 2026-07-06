@echo off
title Inventory Planning Plugin - Servers
echo.
echo ==========================================
echo   INVENTORY PLANNING PLUGIN
echo ==========================================
echo.

echo [1/2] Starting Backend API (Port 5000)...
start "Backend API - Port 5000" cmd /k "cd /d d:\Inventory\backend && node server.js"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Frontend App (Port 5173)...
start "Frontend App - Port 5173" cmd /k "cd /d d:\Inventory\frontend && npm run dev"

timeout /t 5 /nobreak >nul

echo.
echo ==========================================
echo   Both servers are starting up!
echo   Open: http://localhost:5173
echo ==========================================
echo.

start "" "http://localhost:5173"
