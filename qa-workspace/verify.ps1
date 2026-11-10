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
$app=Start-Process -FilePath $env:TBV_TEST_EXE -PassThru
try{
  Click-Ui (Wait-Ui '^Close$' 'Button')
  if(!$app.WaitForExit(15000)){throw 'Initial run did not close'}
  & python (Join-Path $PSScriptRoot seed.py)
  if($LASTEXITCODE){throw 'Cannot seed the two test books'}
  $app=Start-Process -FilePath $env:TBV_TEST_EXE -PassThru
  $screen=[Windows.Forms.Screen]::PrimaryScreen.Bounds
  $middle=$screen.X+$screen.Width/2
  Click-Ui (Wait-Ui '^Archive(?: .*)?$' 'Button')
  Click-Ui (Wait-Ui '^Sanctum(?: .*)?$' 'Button') $true
  Click-Ui (Wait-Ui '^Split screen$' 'MenuItem')
  $null=Wait-Ui '^Close split$' 'Button'
  $archive=Wait-Ui '^Open Archive$' 'Button' 'right'
  Write-Host 'PASS opened Sanctum in secondary pane from the Archive sidebar'
  Click-Ui $archive
  Click-Ui (Wait-Ui '^(Open |Read )?Split Fixture Beta(?: .*)?$' 'Button' 'right')
  Click-Ui (Wait-Ui '^Read$' 'Button' 'right')
  $null=Wait-Ui '^Next page$' 'Button' 'right'
  Click-Ui (Wait-Ui '^(Open |Read )?Split Fixture Alpha(?: .*)?$' 'Button' 'left')
  Click-Ui (Wait-Ui '^Read$' 'Button' 'left')
  $null=Wait-Ui '^Next page$' 'Button' 'left'
  $null=Wait-Ui '^Split Fixture Alpha$' 'Text' 'left'
  $null=Wait-Ui '^Split Fixture Beta$' 'Text' 'right'
  Click-Ui (Wait-Ui '^Next page$' 'Button' 'right')
  $null=Wait-Ui '^Split Fixture Alpha$' 'Text' 'left'
  Click-Ui (Wait-Ui '^Close split$' 'Button')
  $null=Wait-Ui '^Next page$' 'Button'
  $null=Wait-Ui '^Split Fixture Alpha$' 'Text'
  if(All-Ui '^Split Fixture Beta$'){throw 'Secondary Reader remained after closing split'}
  Write-Host 'PASS installed TBV read two different EPUBs simultaneously and closing split preserved the primary Reader'
}finally{
  if(!$app.HasExited){Stop-Process -Id $app.Id -ErrorAction SilentlyContinue}
}
