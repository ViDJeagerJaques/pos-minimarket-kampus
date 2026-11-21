$ErrorActionPreference = 'Stop'
$spike = "$env:LOCALAPPDATA\Temp\opencode\electron-spike"
$exe = "$spike\node_modules\electron\dist\electron.exe"
$nodeDir = "$env:LOCALAPPDATA\Temp\opencode\node24\node-v24.22.3-win-x64"
$appDir = "D:\pos-minimarket-kampus\desktop"
$outLog = "$env:LOCALAPPDATA\Temp\opencode\task031-e2e-startup.log"

$env:PATH = "$nodeDir;$env:PATH"
$env:POS_NODE_BIN = "$nodeDir\node.exe"
$env:POS_ELECTRON_BENCH = '1'
$env:POS_SPIKE_API_PORT = '8787'
Remove-Item Env:\POS_SPIKE_SCREENSHOT -ErrorAction SilentlyContinue

function Get-TreeWS($rootId) {
  $ids = @($rootId)
  $all = Get-CimInstance Win32_Process
  for ($i=0; $i -lt 4; $i++) {
    $kids = $all | Where-Object { $ids -contains $_.ParentProcessId } | Select-Object -ExpandProperty ProcessId
    $new = $kids | Where-Object { $ids -notcontains $_ }
    if (-not $new) { break }
    $ids += $new
  }
  $sum = [int64]0
  foreach ($id in $ids) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p) { $sum += $p.WorkingSet64 }
  }
  return [math]::Round($sum/1MB,1)
}

function Kill-Tree($proc) {
  $children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $proc.Id } | Select-Object -ExpandProperty ProcessId
  foreach ($c in $children) { Stop-Process -Id $c -Force -ErrorAction SilentlyContinue }
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  try { $proc.WaitForExit(4000) | Out-Null } catch {}
}

$samples = @()
$dom = ''
for ($i=1; $i -le 20; $i++) {
  if (Test-Path $outLog) { Remove-Item $outLog -Force }
  $t0 = Get-Date
  $p = Start-Process -FilePath $exe -ArgumentList "`"$appDir`"" -PassThru -RedirectStandardOutput $outLog -RedirectStandardError "$env:LOCALAPPDATA\Temp\opencode\task031-e2e-startup-err.log"
  $ok = $false
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $outLog) {
      $c = Get-Content $outLog -Raw -ErrorAction SilentlyContinue
      if ($c -match 'POS_SPIKE window_ready') { $ok = $true; break }
    }
    Start-Sleep -Milliseconds 150
  }
  $wall = if ($ok) { [math]::Round(((Get-Date)-$t0).TotalMilliseconds,1) } else { $null }
  $ram = Get-TreeWS $p.Id
  $text = ''
  if (Test-Path $outLog) {
    $m = Select-String -Path $outLog -Pattern 'POS_BENCH app_ready=([\d.]+)ms|POS_BENCH backend_ready=([\d.]+)ms|POS_BENCH window_loaded=([\d.]+)ms|POS_SPIKE dom_text=(.*)'
    $app = ($m | Where-Object { $_.Line -match 'app_ready' } | Select-Object -First 1)
    $bk  = ($m | Where-Object { $_.Line -match 'backend_ready' } | Select-Object -First 1)
    $win = ($m | Where-Object { $_.Line -match 'window_loaded' } | Select-Object -First 1)
    $dm  = ($m | Where-Object { $_.Line -match 'dom_text' } | Select-Object -First 1)
    if ($dm) { $dom = $dm.Line -replace '^.*POS_SPIKE dom_text=', '' }
  }
  $samples += [pscustomobject]@{
    n=$i; ok=$ok; wallMs=$wall; idleRamMB=$ram
    appReadyMs=if($app){[double]$app.Matches[0].Groups[1].Value}else{$null}
    backendReadyMs=if($bk){[double]$bk.Matches[0].Groups[1].Value}else{$null}
    windowLoadedMs=if($win){[double]$win.Matches[0].Groups[1].Value}else{$null}
  }
  Kill-Tree $p
  Start-Sleep -Milliseconds 600
}

$okWalls = @($samples | Where-Object { $_.ok } | ForEach-Object { [double]$_.wallMs } | Sort-Object)
function Pct($arr, $p) { if ($arr.Count -eq 0) { return $null }; $idx = [math]::Ceiling($arr.Count*$p)-1; if($idx -lt 0){$idx=0}; return [math]::Round($arr[$idx],1) }
$summary = [pscustomobject]@{
  total=$samples.Count
  success=$okWalls.Count
  failed=$samples.Count-$okWalls.Count
  minMs=if($okWalls){$okWalls[0]}else{$null}
  medianMs=Pct $okWalls 0.5
  p95Ms=Pct $okWalls 0.95
  maxMs=if($okWalls){$okWalls[-1]}else{$null}
  idleRamMedianMB=(($samples | Where-Object {$_.idleRamMB -gt 0} | ForEach-Object {$_.idleRamMB} | Sort-Object) | ForEach-Object {$_})[9]
  domTextSample=$dom.Substring(0,[Math]::Min(300,$dom.Length))
}
[pscustomobject]@{ summary=$summary; samples=$samples } | ConvertTo-Json -Depth 6 | Tee-Object -FilePath "$env:LOCALAPPDATA\Temp\opencode\task031-startup20.json"
