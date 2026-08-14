@echo off
cd /d "C:\Users\Aero.Process 03\Documents\GitHub\techdenguebackend"
"C:\Program Files\nodejs\node.exe" --use-system-ca scripts\consultar-oni-atual.js --ultimos 6 >> "C:\Users\Aero.Process 03\Documents\GitHub\techdenguebackend\data\el-nino\oni_atual_task.log" 2>&1
