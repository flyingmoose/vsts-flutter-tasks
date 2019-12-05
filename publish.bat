cd .\tasks\test
REM call npm install
call tsc 
cd ..\install
REM call npm install
call tsc
cd ..\build
REM call npm install
call tsc 
cd ..\..\
call tfx extension create --manifest-globs vss-extension.json
