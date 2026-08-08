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
echo [+] Bilgisayarda tarayici aciliyor...
start http://localhost:8001

echo.
echo [+] Web sunucusu port 8000 uzerinde baslatiliyor...
echo [!] Sunucuyu kapatmak icin bu pencereyi kapatabilir veya Ctrl+C yapabilirsiniz.
echo.

:: Start the server
py -3.13 -m http.server 8001

pause
