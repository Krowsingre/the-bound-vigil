$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CloseProbe {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
}
"@
$out=Join-Path $PSScriptRoot result
New-Item -ItemType Directory -Path $out -Force | Out-Null
$root=[Windows.Automation.AutomationElement]::RootElement
$scope=[Windows.Automation.TreeScope]::Descendants
$buttons=New-Object Windows.Automation.AndCondition(
  (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty,'Close')),
  (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button))
)
$rows=@()
foreach($method in @('X','Windows close','X','Windows close','X','Windows close')){
  $app=Start-Process -FilePath $env:TBV_TEST_EXE -PassThru
  try{
    $window=$null;$button=$null
    $ends=(Get-Date).AddSeconds(35)
    do {
      $app.Refresh()
      $handle=$app.MainWindowHandle
      if($handle -and [CloseProbe]::IsWindowVisible($handle)){
        $window=[Windows.Automation.AutomationElement]::FromHandle($handle)
        if($window.Current.Name -eq 'The Bound Vigil'){
          $button=$window.FindFirst($scope,$buttons)
          if($button){break}
        }
      }
      Start-Sleep -Milliseconds 100
    }while((Get-Date) -lt $ends)
    if(!$button){throw 'TBV close button did not become available'}
    Start-Sleep -Milliseconds 250
    $clock=[Diagnostics.Stopwatch]::StartNew()
    if($method -eq 'X'){
      $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    }else{
      if(![CloseProbe]::PostMessage($handle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Could not send WM_CLOSE'}
    }
    $hidden=$null
    do {
      if($null -eq $hidden -and ![CloseProbe]::IsWindowVisible($handle)){$hidden=$clock.ElapsedMilliseconds}
      if($app.HasExited){break}
      Start-Sleep -Milliseconds 15
    }while($clock.ElapsedMilliseconds -lt 14000)
    if(!$app.HasExited){throw 'App did not exit'}
    $row=[pscustomobject]@{Build=$env:TBV_TEST_KIND;Method=$method;HiddenMs=$hidden;ExitedMs=$clock.ElapsedMilliseconds}
    $rows+=$row
    $row | ConvertTo-Json -Compress | Write-Host
    $rows | ConvertTo-Json | Set-Content (Join-Path $out 'timing.json')
  }finally{
    if(!$app.HasExited){Stop-Process -Id $app.Id -ErrorAction SilentlyContinue}
  }
}
Add-Type -AssemblyName System.Windows.Forms
$any=[Windows.Automation.Condition]::TrueCondition
$shell=New-Object -ComObject WScript.Shell
function Find-Ui($regex,$type){
  $until=(Get-Date).AddSeconds(15)
  do{
    foreach($item in $window.FindAll($scope,$any)){
      try {
        if($item.Current.Name -match $regex -and !$item.Current.IsOffscreen -and $item.Current.IsEnabled -and
           (!$type -or $item.Current.ControlType.ProgrammaticName -eq "ControlType.$type")){return $item}
      } catch {}
    }
    Start-Sleep -Milliseconds 200
  }while((Get-Date) -lt $until)
  $window.FindAll($scope,$any) | ForEach-Object {
    try { "$($_.Current.ControlType.ProgrammaticName) $($_.Current.Name) Offscreen=$($_.Current.IsOffscreen)" } catch {}
  } | Select-Object -First 180 | Write-Host
  throw "Could not find $regex"
}
function Click-Ui($item){
  $pattern=$null
  if($item.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){
    $pattern.Invoke()
  }else{
    $point=$item.GetClickablePoint()
    [Windows.Forms.Cursor]::Position=New-Object Drawing.Point([int]$point.X,[int]$point.Y)
    [CloseProbe]::mouse_event(2,0,0,0,[IntPtr]::Zero)
    [CloseProbe]::mouse_event(4,0,0,0,[IntPtr]::Zero)
  }
}
$python=(Get-Command python).Source
$helper=Join-Path $PSScriptRoot scribe.py
& $python $helper seed
if($LASTEXITCODE){throw 'Could not prepare synthetic Scribe data'}
$app=Start-Process -FilePath $env:TBV_TEST_EXE -PassThru
$locker=$null
try{
  $handle=[IntPtr]::Zero
  $ends=(Get-Date).AddSeconds(30)
  do{
    $app.Refresh()
    $handle=$app.MainWindowHandle
    if($handle -and [CloseProbe]::IsWindowVisible($handle)){
      $window=[Windows.Automation.AutomationElement]::FromHandle($handle)
      if($window.Current.Name -eq 'The Bound Vigil' -and $window.FindFirst($scope,$buttons)){break}
    }
    Start-Sleep -Milliseconds 100
  }while((Get-Date) -lt $ends)
  $null=$shell.AppActivate($app.Id)
  Start-Sleep -Seconds 1
  [Windows.Forms.SendKeys]::SendWait('^5')
  Click-Ui (Find-Ui '^Write a book$')
  Click-Ui (Find-Ui '^Shutdown Probe.*' 'Button')
  $editor=Find-Ui '^Chapter text$'
  $close=$window.FindFirst($scope,$buttons)
  if(!$close){throw 'Cannot find close button in Scribe'}
  $ready=Join-Path $out 'lock-ready'
  $release=Join-Path $out 'lock-release'
  $locker=Start-Process -FilePath $python -ArgumentList @(('"{0}"' -f $helper),'lock',('"{0}"' -f $ready),('"{0}"' -f $release)) -PassThru -WindowStyle Hidden
  $ends=(Get-Date).AddSeconds(3)
  while(!(Test-Path $ready)){
    if($locker.HasExited -or (Get-Date) -gt $ends){throw 'Could not hold database lock'}
    Start-Sleep -Milliseconds 20
  }
  $editor.SetFocus()
  [Windows.Forms.SendKeys]::SendWait('^{END} saved on close')
  $clock=[Diagnostics.Stopwatch]::StartNew()
  $close.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
  $hidden=$null
  do{
    if($null -eq $hidden -and ![CloseProbe]::IsWindowVisible($handle)){$hidden=$clock.ElapsedMilliseconds}
    if($clock.ElapsedMilliseconds -ge 650 -and !(Test-Path $release)){New-Item -ItemType File $release | Out-Null}
    if($app.HasExited){break}
    Start-Sleep -Milliseconds 15
  }while($clock.ElapsedMilliseconds -lt 14000)
  if(!$app.HasExited){throw 'App did not exit with a pending Scribe save'}
  $row=[pscustomobject]@{Build=$env:TBV_TEST_KIND;Method='X with pending Scribe save';HiddenMs=$hidden;ExitedMs=$clock.ElapsedMilliseconds}
  $row | ConvertTo-Json -Compress | Write-Host
  $rows+=$row
  $rows | ConvertTo-Json | Set-Content (Join-Path $out 'timing.json')
  if($env:TBV_TEST_KIND -eq 'fixed' -and ($null -eq $hidden -or $hidden -ge 650)){throw 'Window stayed visible during the entire save delay'}
  & $python $helper check
  if($LASTEXITCODE){throw 'Scribe save did not persist'}
}finally{
  if($locker -and !$locker.HasExited){Stop-Process -Id $locker.Id -ErrorAction SilentlyContinue}
  if(!$app.HasExited){Stop-Process -Id $app.Id -ErrorAction SilentlyContinue}
}
