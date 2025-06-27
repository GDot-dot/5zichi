@echo off
echo Starting the Gomoku server...

REM Change to your project directory
cd /d "c:\Users\user\Desktop\test\五子棋trae"

echo Trying to run "npm start"...
REM npm start
echo "npm start" command has been commented out.
echo If "npm start" is the correct way to run your project (check your package.json),
echo ensure you have run "npm install" successfully first.
echo ---
echo Now attempting to start the server directly with "node server.js"...
echo If your main server file is named differently (e.g., app.js, index.js),
echo please edit the "node server.js" line below accordingly.

REM If npm start doesn't work, you might need to run the server file directly.
REM Uncomment one of the lines below if needed, and comment out "npm start" above.
REM Make sure to use the correct server file name (e.g., server.js, app.js, index.js).

REM echo Trying to run "node server.js"... (This line is now active below)
node server.js

REM echo Trying to run "node app.js"...
REM node app.js

REM echo Trying to run "node index.js"...
REM node index.js

echo.
echo If the server started successfully, you should see messages above.
echo If not, please check the output for errors and ensure your start command is correct in this .bat file.

REM Keep the command window open to see server logs
pause
