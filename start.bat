@echo off
echo 正在安装依赖...
call npm install
if %errorlevel% neq 0 (
    echo.
    echo ========================================
    echo 错误：无法找到 npm 命令
    echo ========================================
    echo.
    echo 请按照以下步骤操作：
    echo.
    echo 1. 确认 Node.js 已正确安装
    echo 2. 打开命令提示符或 PowerShell
    echo 3. 运行以下命令：
    echo    cd /d E:\openclaw
    echo    npm install
    echo    node server.js
    echo.
    echo 4. 然后访问 http://localhost:3000
    echo.
    pause
    exit /b 1
)

echo.
echo 依赖安装完成！正在启动服务器...
echo.
node server.js
