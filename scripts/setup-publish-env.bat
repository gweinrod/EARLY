@echo off
setlocal
cd /d "%~dp0.."

echo.
echo EARLY publish setup — saves BLOB_READ_WRITE_TOKEN to .env
echo.
echo In Vercel: Storage - Blob - your store - .env.local tab
echo Copy BLOB_READ_WRITE_TOKEN (starts with vercel_blob_rw_)
echo.
set /p "TOKEN=BLOB_READ_WRITE_TOKEN: "
if "%TOKEN%"=="" (
  echo Cancelled.
  exit /b 1
)

> ".env" echo BLOB_READ_WRITE_TOKEN=%TOKEN%
echo.
echo Wrote C:\EARLY\.env
echo Run: scripts\publish-shared-model.bat deploy
endlocal
