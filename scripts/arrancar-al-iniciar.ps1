# Registra Mastropiero para que arranque solo al iniciar sesión en Windows (Programador de tareas).
# Correlo vos, una vez, en PowerShell desde la carpeta del proyecto:
#   powershell -ExecutionPolicy Bypass -File scripts\arrancar-al-iniciar.ps1
# Para sacarlo:  Unregister-ScheduledTask -TaskName Mastropiero -Confirm:$false
$proyecto = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$accion = New-ScheduledTaskAction -Execute $node -Argument '--disable-warning=ExperimentalWarning src/servidor.ts' -WorkingDirectory $proyecto
$disparo = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'Mastropiero' -Action $accion -Trigger $disparo -Settings $ajustes -Description 'Deprocast 1.0: Mastropiero siempre prendido' -Force | Out-Null
Write-Host "Listo: Mastropiero arranca solo al iniciar sesión (http://127.0.0.1:7272). Para probar ya: Start-ScheduledTask -TaskName Mastropiero"
