$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms
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
    $shell.SendKeys('^5')
    Invoke-Ui (Wait-Ui '^Write a book$')
    Invoke-Ui (Wait-Ui '^Shutdown Probe.*' 'Button')
    $null=Wait-Ui '^Chapter text$'
    Invoke-Ui (Wait-Ui '^Export$' 'Button')
    Invoke-Ui (Wait-Ui '^Print PDF.*')
    Invoke-Ui (Wait-Ui '^Export$' 'Button')
    Start-Sleep -Milliseconds 950
    $pdf=Join-Path $out 'Native Print.pdf'
    [Windows.Forms.Clipboard]::SetText($pdf)
    [Windows.Forms.SendKeys]::SendWait('%n^a^v{ENTER}')
    $deadline=(Get-Date).AddSeconds(50)
    while(!(Test-Path $pdf) -and (Get-Date) -lt $deadline){Start-Sleep -Milliseconds 300}
    if(!(Test-Path $pdf)){throw 'Native PDF was not created'}
    & python -c 'import sys; from pypdf import PdfReader; pages=PdfReader(sys.argv[1]).pages; assert len(pages)>0; assert any("Initial words" in page.extract_text() for page in pages)' $pdf
    if($LASTEXITCODE){throw 'PDF text check failed'}
    Write-Host 'PASS Native Windows Scribe PDF includes the original chapter text'
    return
  }
  $shell.SendKeys('^o')
  Start-Sleep -Milliseconds 950
  [Windows.Forms.Clipboard]::SetText($source)
  [Windows.Forms.SendKeys]::SendWait('%n^a^v{ENTER}')
  Start-Sleep -Seconds 2
  $null=$shell.AppActivate($app.Id)
  $shell.SendKeys('^2')
  $book=Wait-Ui '^(?:Open |Read )?Scribe Fixture' 'Button'
  Invoke-Ui $book
  if(!(Find-Ui '^Next page$' 'Button')){
    $read=Find-Ui '^(Read|Open book|Continue reading)( .*)?$' 'Button'
    if($read){Invoke-Ui $read}
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
  Start-Sleep -Milliseconds 700
  [Windows.Forms.Clipboard]::SetText($out)
  [Windows.Forms.SendKeys]::SendWait('%d^a^v{ENTER}')
  Start-Sleep -Milliseconds 400
  [Windows.Forms.SendKeys]::SendWait('{ENTER}')
  $deadline=(Get-Date).AddSeconds(20)
  do{
    $copy=Get-ChildItem $out -Filter '*.epub' | Select-Object -First 1
    if($copy){break}
    Start-Sleep -Milliseconds 200
  }while((Get-Date) -lt $deadline)
  if(!$copy -or (Get-FileHash $copy.FullName).Hash -ne (Get-FileHash $source).Hash){throw 'Export was missing or differed byte for byte'}
  Write-Host 'PASS Installed Windows Save a copy and native folder picker preserved every byte'
}finally{
  if(!$app.HasExited){Stop-Process -Id $app.Id -ErrorAction SilentlyContinue}
}
