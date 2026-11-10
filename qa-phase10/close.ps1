$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CloseProbe {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
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
