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
function Go-To($url,$side){
  $field=Wait-Ui '^Search$' 'Edit' $side
  Click-Ui $field
  $shell=New-Object -ComObject WScript.Shell
  $shell.SendKeys('^a')
  $shell.SendKeys("http://127.0.0.1:19421/$url")
  $shell.SendKeys('{ENTER}')
}
$server=Start-Process -FilePath (Get-Command node).Source -ArgumentList (Join-Path $PSScriptRoot server.cjs) -WindowStyle Hidden -PassThru
function Open-Split($label){
  $shell=New-Object -ComObject WScript.Shell
  for($attempt=0;$attempt -lt 3;$attempt++){
    Click-Ui (Wait-Ui $label 'Button' 'left') $true
    Start-Sleep -Milliseconds 400
    $option=Wait-Ui '^Split screen$' 'MenuItem'
    if($attempt -eq 0){
      try{$option.SetFocus()}catch [Windows.Automation.ElementNotAvailableException]{continue}
      $shell.SendKeys('{ENTER}')
    }else{
      $rect=$option.Current.BoundingRectangle
      [Windows.Forms.Cursor]::Position=New-Object Drawing.Point([int]($rect.X+$rect.Width/2),[int]($rect.Y+$rect.Height/2))
      [Pointer]::mouse_event(2,0,0,0,[IntPtr]::Zero)
      [Pointer]::mouse_event(4,0,0,0,[IntPtr]::Zero)
    }
    Start-Sleep -Milliseconds 1100
    if(All-Ui '^Close split$'){return}
    $shell.SendKeys('{ESC}')
  }
  $null=Wait-Ui '^Close split$' 'Button'
}
$app=Start-Process -FilePath $env:TBV_TEST_EXE -PassThru
try{
  $screen=[Windows.Forms.Screen]::PrimaryScreen.Bounds
  $middle=$screen.X+$screen.Width/2
  Click-Ui (Wait-Ui '^Discover(?: .*)?$' 'Button' 'left')
  Open-Split '^Discover(?: .*)?$'
  $null=Wait-Ui '^Close split$' 'Button'
  Go-To 'left' 'left'
  $null=Wait-Ui '^Left fixture$' 'Text' 'left'
  Go-To 'right' 'right'
  $null=Wait-Ui '^Right fixture$' 'Text' 'right'
  $null=Wait-Ui '^Left fixture$' 'Text' 'left'
  Write-Host 'PASS the real WebView2 pages occupy separate panes'
  Click-Ui (Wait-Ui '^Open the fixture link$' 'Hyperlink' 'left') $true
  Click-Ui (Wait-Ui '^Open link in new tab$')
  $null=Wait-Ui '^Link target fixture$' 'TabItem' 'left'
  $null=Wait-Ui '^Left fixture$' 'Text' 'left'
  $null=Wait-Ui '^Right fixture$' 'Text' 'right'
  Write-Host 'PASS actual WebView2 link context menu opened a background tab in the originating pane'
}finally{
  if(!$app.HasExited){Stop-Process -Id $app.Id -ErrorAction SilentlyContinue}
  if(!$server.HasExited){Stop-Process -Id $server.Id -ErrorAction SilentlyContinue}
}
