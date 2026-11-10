$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Pointer {
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
}
"@
$root=[Windows.Automation.AutomationElement]::RootElement
$scope=[Windows.Automation.TreeScope]::Descendants
$any=[Windows.Automation.Condition]::TrueCondition
function All-Ui($regex){
  $processFilter=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,$app.Id)
  foreach($top in $root.FindAll([Windows.Automation.TreeScope]::Children,$processFilter)){
    foreach($item in $top.FindAll($scope,$any)){
      try{
        if($item.Current.Name -match $regex -and !$item.Current.IsOffscreen -and $item.Current.IsEnabled){$item}
      }catch{}
    }
  }
}
function Wait-Ui($regex,$type,$side='any'){
  $until=(Get-Date).AddSeconds(35)
  do{
    foreach($item in (All-Ui $regex)){
      $x=$item.Current.BoundingRectangle.X
      if((!$type -or $item.Current.ControlType.ProgrammaticName -eq "ControlType.$type") -and
        ($side -eq 'any' -or ($side -eq 'left' -and $x -lt $middle) -or ($side -eq 'right' -and $x -ge $middle))){return $item}
    }
    Start-Sleep -Milliseconds 200
  }while((Get-Date) -lt $until)
  All-Ui '.' | ForEach-Object { "$($_.Current.ControlType.ProgrammaticName) $($_.Current.Name) $($_.Current.BoundingRectangle)" } | Select-Object -First 250 | Write-Host
  throw "Unavailable: $regex ($type, $side)"
}
function Click-Ui($item,[bool]$right=$false){
  if(!$right -and $item.Current.ControlType -ne [Windows.Automation.ControlType]::Edit){
    $invoke=$null
    if($item.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)){
      try{$invoke.Invoke()}catch [Windows.Automation.ElementNotAvailableException]{}
      Start-Sleep -Milliseconds 300
      return
    }
  }
  $rect=$item.Current.BoundingRectangle
  [Windows.Forms.Cursor]::Position=New-Object Drawing.Point([int]($rect.X+$rect.Width/2),[int]($rect.Y+$rect.Height/2))
  if($right){[Pointer]::mouse_event(8,0,0,0,[IntPtr]::Zero); [Pointer]::mouse_event(16,0,0,0,[IntPtr]::Zero)}
  else{[Pointer]::mouse_event(2,0,0,0,[IntPtr]::Zero); [Pointer]::mouse_event(4,0,0,0,[IntPtr]::Zero)}
}
$shell=New-Object -ComObject WScript.Shell
$app=Start-Process -FilePath $env:TBV_TEST_EXE -PassThru
try {
  Click-Ui (Wait-Ui '^Close$' 'Button')
  if(!$app.WaitForExit(15000)){throw 'Initial run did not close'}
  & python (Join-Path $PSScriptRoot seed.py)
  if($LASTEXITCODE){throw 'Unable to seed the synthetic series'}
  $app=Start-Process -FilePath $env:TBV_TEST_EXE -PassThru
  Click-Ui (Wait-Ui '^Open series Update Fixture$' 'Button')
  $null=Wait-Ui '^Update Fixture$' 'Text'
  Click-Ui (Wait-Ui '^Resonance(?: .*)?$' 'Button')
  Click-Ui (Wait-Ui '^Archive(?: .*)?$' 'Button')
  $null=Wait-Ui '^Update Fixture$' 'Text'
  Click-Ui (Wait-Ui '^Archive(?: .*)?$' 'Button')
  $null=Wait-Ui '^Archive$' 'Text'
  Write-Host 'PASS installed Recently Added stack and sidebar reset/resume'
  Click-Ui (Wait-Ui '^Discover(?: .*)?$' 'Button')
  $null=Wait-Ui '^Discover$' 'Text'
  $null=$shell.AppActivate($app.Id)
  $shell.SendKeys('^k')
  $shell.SendKeys('middle edit')
  $field=Wait-Ui '^Search$' 'Edit'
  $value=$field.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
  if($value.Current.Value -ne 'middle edit'){throw "Unexpected address input '$($value.Current.Value)'"}
  $shell.SendKeys('{HOME}{RIGHT 3}{BACKSPACE}')
  Start-Sleep -Milliseconds 300
  if($value.Current.Value -ne 'midle edit'){throw "Unexpected address after caret edit '$($value.Current.Value)'"}
  Write-Host 'PASS Windows WebView2 address input accepted typing and an in-place caret edit'
}finally{
  if(!$app.HasExited){Stop-Process -Id $app.Id -ErrorAction SilentlyContinue}
}
