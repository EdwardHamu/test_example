@echo off
chcp 65001 >nul
cd /d "%~dp0"

:: 同时支持 HTTP/HTTPS 全协议代理，并保留 remote-debugging-port
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 --proxy-server="127.0.0.1:7890"

start "" "%~dp0Arena筛选助手.exe" %*
