@echo off
title Ayo Web Sunucusu
cls

echo ====================================================
echo             AYO WEB OYUN SUNUCUSU
echo ====================================================
echo.

:: Find the local IP address
for /f "usebackq tokens=*" %%a in (`powershell -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notlike '127.*' -and $_.InterfaceAlias -notlike '*Loopback*' -and $_.IPAddress -notlike '169.254.*'}).IPAddress[0]"`) do set LOCAL_IP=%%a

if "%LOCAL_IP%"=="" (
    set LOCAL_IP=localhost
    echo [UYARI] Yerel IP adresi bulunamadi. Sadece bu bilgisayardan oynanabilir.
) else (
    echo [+] Yerel IP adresi tespit edildi: %LOCAL_IP%
    echo.
    echo ----------------------------------------------------
    echo OYUNU MOBILDE OYNAMAK ICIN:
    echo 1. Telefonunuzu bu bilgisayarla AYNI Wi-Fi agina baglayin.
    echo 2. Telefonunuzun tarayicisina sunu yazin:
    echo.
    echo    http://%LOCAL_IP%:8001
    echo.
    echo ----------------------------------------------------
)

echo.
:: Node.js is required for the online server
where node >nul 2>nul
if errorlevel 1 (
    echo [HATA] Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun.
    pause
    exit /b 1
)

cd /d "%~dp0"
if not exist "node_modules\" (
    echo [+] Gerekli paketler kuruluyor ^(sadece ilk seferde^)...
    call npm install --omit=dev
    if errorlevel 1 (
        echo [HATA] Paketler kurulamadi. Internet baglantinizi kontrol edin.
        pause
        exit /b 1
    )
)

echo [+] Bilgisayarda tarayici aciliyor...
start http://localhost:8001

echo.
echo [+] Oyun sunucusu port 8001 uzerinde baslatiliyor...
echo [!] Sunucuyu kapatmak icin bu pencereyi kapatabilir veya Ctrl+C yapabilirsiniz.
echo.

:: Start the server (game files + online features)
node server.js

pause
