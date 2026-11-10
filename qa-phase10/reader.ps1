$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PickerProbe {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hwnd, int id);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
}
"@
function Wait-Picker($title){
  $until=(Get-Date).AddSeconds(15)
  do{
    $handle=[PickerProbe]::FindWindow('#32770',$title)
    if($handle -ne [IntPtr]::Zero){return $handle}
    Start-Sleep -Milliseconds 200
  }while((Get-Date) -lt $until)
  throw "Picker did not appear: $title"
}
function Confirm-Picker($handle){
  $picker=[Windows.Automation.AutomationElement]::FromHandle($handle)
  $options=$picker.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
  $ok=$options | Where-Object { $_.Current.Name -match '^(Select Folder|Save)$' -and !$_.Current.IsOffscreen } | Select-Object -Last 1
  if(!$ok){throw 'No accessible native confirmation control'}
  $r=$ok.Current.BoundingRectangle
  if($r.IsEmpty){throw 'Native confirmation control has no bounds'}
  [Windows.Forms.Cursor]::Position=New-Object Drawing.Point([int]($r.X+$r.Width/2),[int]($r.Y+$r.Height/2))
  [PickerProbe]::mouse_event(2,0,0,0,[IntPtr]::Zero)
  [PickerProbe]::mouse_event(4,0,0,0,[IntPtr]::Zero)
}
$root=[Windows.Automation.AutomationElement]::RootElement
$scope=[Windows.Automation.TreeScope]::Descendants
$any=[Windows.Automation.Condition]::TrueCondition
$shell=New-Object -ComObject WScript.Shell
$out=Join-Path $PSScriptRoot 'reader-result'
New-Item -ItemType Directory $out -Force | Out-Null
$source=Join-Path $PSScriptRoot 'scribe-figure.epub'
$app=Start-Process -FilePath $env:TBV_TEST_EXE -PassThru
$processFilter=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,$app.Id)
function Find-Ui($pattern,$type){
  foreach($top in $root.FindAll([Windows.Automation.TreeScope]::Children,$processFilter)){
    foreach($item in $top.FindAll($scope,$any)){
      try {
        if($item.Current.Name -match $pattern -and !$item.Current.IsOffscreen -and $item.Current.IsEnabled -and
          (!$type -or $item.Current.ControlType.ProgrammaticName -eq "ControlType.$type")){return $item}
      }catch{}
    }
  }
}
function Wait-Ui($pattern,$type,$seconds=20){
  $until=(Get-Date).AddSeconds($seconds)
  do{
    $item=Find-Ui $pattern $type
    if($item){return $item}
    Start-Sleep -Milliseconds 200
  }while((Get-Date) -lt $until)
  foreach($top in $root.FindAll([Windows.Automation.TreeScope]::Children,$processFilter)){
    $top.FindAll($scope,$any) | ForEach-Object {
      try { "$($_.Current.ControlType.ProgrammaticName) $($_.Current.Name) Offscreen=$($_.Current.IsOffscreen)" } catch {}
    } | Select-Object -First 220 | Write-Host
  }
  throw "Missing $pattern"
}
function Invoke-Ui($item){
  $pattern=$null
  if($item.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){$pattern.Invoke()}
  else{$item.SetFocus();$shell.SendKeys('{ENTER}')}
}
function Enter-Path($edit,$path){
  $pattern=$null
  if($edit.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){
    $pattern.SetValue($path)
  }else{
    $edit.SetFocus()
    [Windows.Forms.Clipboard]::SetText($path)
    $shell.SendKeys('^a^v')
  }
}
try{
  $null=Wait-Ui '^Close$' 'Button' 45
  $null=$shell.AppActivate($app.Id)
  if($env:TBV_VERIFY_KIND -eq 'print'){
    Invoke-Ui (Wait-Ui '^Close$' 'Button')
    if(!$app.WaitForExit(15000)){throw 'Initial app run did not close'}
    & python (Join-Path $PSScriptRoot scribe.py) seed
    if($LASTEXITCODE){throw 'Could not seed synthetic Scribe book'}
    $app=Start-Process -FilePath $env:TBV_TEST_EXE -PassThru
    $processFilter=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,$app.Id)
    $null=Wait-Ui '^Close$' 'Button' 45
    $null=$shell.AppActivate($app.Id)
    Invoke-Ui (Wait-Ui '^Scribe .*' 'Button')
    Invoke-Ui (Wait-Ui '^Write a book$')
    Invoke-Ui (Wait-Ui '^Shutdown Probe.*' 'Button')
    $null=Wait-Ui '^Chapter text$'
    Invoke-Ui (Wait-Ui '^Export$' 'Button')
    Invoke-Ui (Wait-Ui '^Print PDF.*' 'RadioButton')
    Start-Sleep -Milliseconds 400
    $export=$null
    foreach($top in $root.FindAll([Windows.Automation.TreeScope]::Children,$processFilter)){
      $export=$top.FindAll($scope,$any) | Where-Object {
        $_.Current.Name -eq 'Export' -and $_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and $_.Current.IsEnabled
      } | Select-Object -Last 1
      if($export){break}
    }
    if(!$export){throw 'Could not find the enabled Export submit button'}
    Invoke-Ui $export
    $picker=Wait-Picker 'Save the PDF'
    [PickerProbe]::SetForegroundWindow($picker) | Out-Null
$documents=[Environment]::GetFolderPath('MyDocuments')
    $pdf=Join-Path $documents 'Shutdown Probe.pdf'
    [Windows.Forms.Clipboard]::SetText($pdf)
    [Windows.Forms.SendKeys]::SendWait('%n^a^v')
    Confirm-Picker $picker
    $deadline=(Get-Date).AddSeconds(50)
    while(!(Test-Path $pdf) -and (Get-Date) -lt $deadline){Start-Sleep -Milliseconds 300}
    if(!(Test-Path $pdf)){
      Get-ChildItem $documents,$out -Filter '*.pdf' | Select-Object FullName,Length | Write-Host
      $active=[PickerProbe]::FindWindow('#32770','Save the PDF')
      throw "Native PDF was not created. Picker still present: $($active -ne [IntPtr]::Zero)"
    }
    & python (Join-Path $PSScriptRoot pdf_check.py) $pdf
    if($LASTEXITCODE){throw 'PDF text check failed'}
    Write-Host 'PASS Native Windows Scribe PDF includes the original chapter text'
    return
  }
  Invoke-Ui (Wait-Ui '^Close$' 'Button')
  if(!$app.WaitForExit(15000)){throw 'Initial app run did not close'}
  & python (Join-Path $PSScriptRoot scribe.py) seed-reader $source
  if($LASTEXITCODE){throw 'Could not seed synthetic Reader book'}
  $app=Start-Process -FilePath $env:TBV_TEST_EXE -PassThru
  $processFilter=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,$app.Id)
  Invoke-Ui (Wait-Ui '^Archive .*' 'Button' 45)
  $book=Wait-Ui '^(?:Open |Read )?Scribe Fixture' 'Button'
  Invoke-Ui $book
  if(!(Find-Ui '^Next page$' 'Button')){
    Invoke-Ui (Wait-Ui '^(Read|Open book|Continue reading)( .*)?$' 'Button' 10)
  }
  $expand=$null
  for($i=0;$i -lt 10;$i++){
    Start-Sleep -Milliseconds 350
    $expand=Find-Ui '^Expand Fixture caption$' 'Button'
    if($expand){break}
    Invoke-Ui (Wait-Ui '^Next page$' 'Button' 10)
  }
  if(!$expand){$expand=Wait-Ui '^Expand Fixture caption$' 'Button' 2}
  Invoke-Ui $expand
  $zoom=Wait-Ui '^Zoom in$' 'Button'
  Invoke-Ui $zoom
  $shell.SendKeys('{ESC}')
  $null=Wait-Ui '^Expand Fixture caption$' 'Button'
  Write-Host 'PASS Installed Windows Reader opened and closed the expanded figure and used Zoom in'
  Invoke-Ui (Wait-Ui '^More$' 'Button')
  Invoke-Ui (Wait-Ui '^Save a copy \(EPUB\)$')
  $picker=Wait-Picker 'Save copies to this folder'
  [PickerProbe]::SetForegroundWindow($picker) | Out-Null
  [Windows.Forms.Clipboard]::SetText($out)
  [Windows.Forms.SendKeys]::SendWait('%n^a^v')
  Confirm-Picker $picker
  $deadline=(Get-Date).AddSeconds(20)
  do{
    $copy=Get-ChildItem $out,([Environment]::GetFolderPath('MyDocuments')) -Filter '*.epub' | Select-Object -First 1
    if($copy){break}
    Start-Sleep -Milliseconds 200
  }while((Get-Date) -lt $deadline)
  if(!$copy){
    $active=[PickerProbe]::FindWindow('#32770','Save copies to this folder')
    throw "Copy missing. Picker still present: $($active -ne [IntPtr]::Zero)"
  }
  if((Get-FileHash $copy.FullName).Hash -ne (Get-FileHash $source).Hash){throw 'Export differed byte for byte'}
  Write-Host 'PASS Installed Windows Save a copy and native folder picker preserved every byte'
}finally{
  if(!$app.HasExited){Stop-Process -Id $app.Id -ErrorAction SilentlyContinue}
}
