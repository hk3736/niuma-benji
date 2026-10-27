@echo off
REM EveryLog 本地打包（不需要 DCloud 账号、不联网付费）
REM 用法：双击本文件，或在本目录执行 build-apk.bat
setlocal
set JAVA_HOME=C:\Users\User\.android-build\jdk\jdk-17.0.20.1+1
set ANDROID_HOME=C:\Users\User\.android-build\sdk
set ANDROID_SDK_ROOT=%ANDROID_HOME%
set PATH=%JAVA_HOME%\bin;%PATH%

cd /d "%~dp0"

echo [1/3] 编译 H5 前端...
call npm run build:h5 || goto :err

echo [2/3] 同步到 Android 工程...
call npx cap sync android || goto :err

echo [3/3] 打包 APK...
cd android
call gradlew.bat assembleDebug --console=plain || goto :err
cd ..

set APK=%~dp0android\app\build\outputs\apk\debug\app-debug.apk
copy /y "%APK%" "%~dp0..\EveryLog-1.0-debug.apk" >nul
echo.
echo 完成：%APK%
echo 已复制到：%~dp0..\EveryLog-1.0-debug.apk
exit /b 0

:err
echo.
echo 打包失败，请把上面的报错发给我。
exit /b 1
