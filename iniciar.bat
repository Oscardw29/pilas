@echo off
title ¡Pilas! - Servidor de Desarrollo
cd /d "%~dp0"

echo ===================================================
echo   CONSTANCIA APP - INICIALIZADOR AUTOMATICO
echo ===================================================
echo.

:: 1. Verificar si Node.js esta instalado
node -v >nul 2>&1
if errorlevel 1 goto :no_node

:: 2. Verificar si npm esta disponible
call npm -v >nul 2>&1
if errorlevel 1 goto :no_npm

:: 3. Verificar si existe la carpeta node_modules
if not exist "node_modules\" goto :install_deps

goto :run_app

:install_deps
echo [INFO] No se encontro la carpeta node_modules.
echo Instalando dependencias necesarias con npm install...
echo Esto solo se hace una vez, por favor espera...
echo.
call npm install
if errorlevel 1 goto :install_error
echo.
echo [OK] Dependencias instaladas correctamente.
echo.
goto :run_app

:run_app
echo ===================================================
echo   Iniciando aplicacion: http://localhost:5173
echo   (Presiona Ctrl+C en esta ventana para detener)
echo ===================================================
echo.
call npm run dev
goto :end

:no_node
echo.
echo [ERROR] Node.js no esta instalado en esta computadora.
echo.
echo Para ejecutar la aplicacion necesitas instalar Node.js:
echo 1. Descargalo gratis desde: https://nodejs.org
echo 2. Instala la version recomendada (LTS).
echo 3. Luego de instalarlo, vuelve a abrir este archivo iniciar.bat.
echo.
echo ===================================================
pause
exit /b 1

:no_npm
echo.
echo [ERROR] No se pudo encontrar el comando npm en el sistema.
echo Si acabas de instalar Node.js, reinicia esta ventana o tu PC.
echo.
pause
exit /b 1

:install_error
echo.
echo [ERROR] Ocurrio un error al ejecutar npm install.
echo Verifica tu conexion a internet e intentalo nuevamente.
echo.
pause
exit /b 1

:end
echo.
echo ===================================================
echo El servidor se ha detenido.
echo ===================================================
pause
