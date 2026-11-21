$ErrorActionPreference = 'Stop'
$spike = "$env:LOCALAPPDATA\Temp\opencode\electron-spike"
$exe = "$spike\node_modules\electron\dist\electron.exe"
$nodeDir = "$env:LOCALAPPDATA\Temp\opencode\node24\node-v24.22.3-win-x64"
$appDir = "D:\pos-minimarket-kampus\desktop"
$db = "$env:APPDATA\pos-minimarket-kampus-desktop\pos-dev.sqlite"
foreach($f in @($db, "$db-wal", "$db-shm")) { if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue } }
$log = "$env:LOCALAPPDATA\Temp\opencode\task031-smoke2-electron.log"
$smokeLog = "$env:LOCALAPPDATA\Temp\opencode\task031-smoke2.log"

$env:PATH = "$nodeDir;$env:PATH"
$env:POS_NODE_BIN = "$nodeDir\node.exe"
$env:POS_ELECTRON_BENCH = '1'
$env:POS_SPIKE_API_PORT = '8787'
Remove-Item Env:\POS_SPIKE_SCREENSHOT -ErrorAction SilentlyContinue
if (Test-Path $log) { Remove-Item $log -Force }
if (Test-Path $smokeLog) { Remove-Item $smokeLog -Force }
$benchLog = "$env:LOCALAPPDATA\Temp\opencode\task031-catalog-bench2.log"
if (Test-Path $benchLog) { Remove-Item $benchLog -Force }

function Get-TreeWS($rootId) {
  $ids = @($rootId); $all = Get-CimInstance Win32_Process
  for ($i=0; $i -lt 4; $i++) {
    $kids = $all | Where-Object { $ids -contains $_.ParentProcessId } | Select-Object -ExpandProperty ProcessId
    $new = $kids | Where-Object { $ids -notcontains $_ }
    if (-not $new) { break }
    $ids += $new
  }
  $sum=[int64]0
  foreach($id in $ids){ $p=Get-Process -Id $id -ErrorAction SilentlyContinue; if($p){$sum += $p.WorkingSet64} }
  return [math]::Round($sum/1MB,1)
}

$t0 = Get-Date
$p = Start-Process -FilePath $exe -ArgumentList "`"$appDir`"" -PassThru -RedirectStandardOutput $log -RedirectStandardError "$env:LOCALAPPDATA\Temp\opencode\task031-smoke2-err.log"
$ready=$false; $readyWallMs=$null; $deadline=(Get-Date).AddSeconds(30)
while((Get-Date) -lt $deadline){
  if(Test-Path $log){ $c=Get-Content $log -Raw -ErrorAction SilentlyContinue; if($c -match 'POS_SPIKE window_ready'){$ready=$true; $readyWallMs=[math]::Round(((Get-Date)-$t0).TotalMilliseconds,1); break} }
  Start-Sleep -Milliseconds 150
}
$idle = Get-TreeWS $p.Id
$smokeOk=$false
$smokeTail=''
$catalogBench=''
if($ready){
  $env:POS_SPIKE_DB = $db
  $env:POS_SPIKE_CREDS_FILE = "$env:LOCALAPPDATA\Temp\opencode\task031-creds.json"
  if (Test-Path $env:POS_SPIKE_CREDS_FILE) { Remove-Item $env:POS_SPIKE_CREDS_FILE -Force }
  Push-Location "D:\pos-minimarket-kampus"
  & "$nodeDir\node.exe" "scripts\task-031_electron_smoke.mjs" *>&1 | Out-File $smokeLog -Encoding utf8
  $benchLog = "$env:LOCALAPPDATA\Temp\opencode\task031-catalog-bench2.log"
  & "$nodeDir\node.exe" "scripts\task-031_catalog_bench.mjs" *>&1 | Out-File $benchLog -Encoding utf8
  Pop-Location
  $smokeOk = Select-String -Path $smokeLog -Pattern 'PASS total 8' -Quiet
  if ($smokeOk) { $smokeTail = (Get-Content $smokeLog -Tail 12 -ErrorAction SilentlyContinue) -join ' | ' }
  if (Test-Path $benchLog) { $catalogBench = (Get-Content $benchLog -Raw -ErrorAction SilentlyContinue) }
}
$after = Get-TreeWS $p.Id
$children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $p.Id } | Select-Object -ExpandProperty ProcessId
foreach($c in $children){ Stop-Process -Id $c -Force -ErrorAction SilentlyContinue }
if(-not $p.HasExited){ Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
try{ $p.WaitForExit(4000) | Out-Null }catch{}

[pscustomobject]@{
  ready=$ready
  readyWallMs=if($ready){$readyWallMs}else{$null}
  idleRamMB=$idle
  afterCheckoutRamMB=$after
  smokeOk=$smokeOk
  smokeTail=$smokeTail
  catalogBench=$catalogBench
  bench=(Get-Content $log -ErrorAction SilentlyContinue | Where-Object {$_ -match 'POS_BENCH'}) -join ' | '
} | ConvertTo-Json -Depth 4 | Tee-Object -FilePath "$env:LOCALAPPDATA\Temp\opencode\task031-smoke-result2.json"

