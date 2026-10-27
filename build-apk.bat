@echo off
REM EveryLog 本地打包（不需要 DCloud 账号、不联网付费）
REM 用法：双击本文件，或在本目录执行 build-apk.bat
REM
REM 依赖：
REM   1) Node.js + 已执行 npm install
REM   2) JDK 17
REM   3) Android SDK (platform-tools / build-tools / platform android-3x)
REM 若 JAVA_HOME / ANDROID_HOME 未设置，可在本目录建一个 build-apk.local.bat
REM 写入自己的路径（该文件已被 .gitignore 忽略），本脚本会自动调用。
setlocal

cd /d "%~dp0"

if exist "%~dp0build-apk.local.bat" call "%~dp0build-apk.local.bat"

if not defined JAVA_HOME (
  if exist "%LOCALAPPDATA%\Android\jbr" set "JAVA_HOME=%LOCALAPPDATA%\Android\jbr"
)
if not defined ANDROID_HOME (
  if defined ANDROID_SDK_ROOT set "ANDROID_HOME=%ANDROID_SDK_ROOT%"
)
if not defined ANDROID_HOME (
  if exist "%LOCALAPPDATA%\Android\Sdk" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
)
if defined ANDROID_HOME set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
if defined JAVA_HOME set "PATH=%JAVA_HOME%\bin;%PATH%"

if not defined JAVA_HOME (
  echo [错误] 未找到 JDK，请安装 JDK 17 并设置 JAVA_HOME。
  exit /b 1
)
if not defined ANDROID_HOME (
  echo [错误] 未找到 Android SDK，请设置 ANDROID_HOME。
  exit /b 1
)

echo [1/3] 编译 H5 前端...
call npm run build:h5 || goto :err

echo [2/3] 同步到 Android 工程...
call npx cap sync android || goto :err

echo [3/3] 打包 APK...
cd android
call gradlew.bat assembleDebug --console=plain || goto :err
cd ..

set APK=%~dp0android\app\build\outputs\apk\debug\app-debug.apk
copy /y "%APK%" "%~dp0..\EveryLog-debug.apk" >nul
echo.
echo 完成：%APK%
echo 已复制到：%~dp0..\EveryLog-debug.apk
exit /b 0

:err
echo.
echo 打包失败，请检查上面的报错信息。
exit /b 1
