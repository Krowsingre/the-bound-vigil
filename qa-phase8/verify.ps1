$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -AssemblyName System.Drawing,System.Windows.Forms
$out=Join-Path $PSScriptRoot result
New-Item -ItemType Directory -Path $out -Force | Out-Null
$server=Start-Process node -ArgumentList (Join-Path $PSScriptRoot server.cjs) -WindowStyle Hidden -PassThru
$app=Start-Process -FilePath $env:TBV_TEST_EXE -PassThru
$shell=New-Object -ComObject WScript.Shell
$root=[Windows.Automation.AutomationElement]::RootElement
$scope=[Windows.Automation.TreeScope]::Descendants
$any=[Windows.Automation.Condition]::TrueCondition
$stage=Join-Path $env:APPDATA 'com.krowsingre.theboundvigil/Browser downloads'
function AppWindow {
  $cond=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,$app.Id)
  $matches=$root.FindAll([Windows.Automation.TreeScope]::Children,$cond)
  foreach($item in $matches){if($item.Current.Name -eq 'The Bound Vigil'){return $item}}
}
function FindElement($pattern,$type) {
  $window=AppWindow
  if(!$window){return}
  foreach($item in $window.FindAll($scope,$any)){
    try {
      if($item.Current.ControlType -eq [Windows.Automation.ControlType]::ListItem -and $pattern -ne "Coming down"){continue}
      if($type -and $item.Current.ControlType.ProgrammaticName -ne "ControlType.$type"){continue}
      if($item.Current.Name -match $pattern -and !$item.Current.IsOffscreen -and $item.Current.IsEnabled){return $item}
    } catch {}
  }
}
function WaitElement($pattern,[int]$seconds=20,$type) {
  $until=(Get-Date).AddSeconds($seconds)
  do {
    $item=FindElement $pattern $type
    if($item){return $item}
    Start-Sleep -Milliseconds 300
  } while((Get-Date) -lt $until)
  throw "UI element unavailable: $pattern"
}
function Activate($element) {
  $pattern=$null
  if($element.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){
    $pattern.Invoke()
    return
  }
  $element.SetFocus()
  $shell.SendKeys('{ENTER}')
}
function GoTo($path) {
  $null=$shell.AppActivate($app.Id)
  $shell.SendKeys('^k')
  $shell.SendKeys('http://127.0.0.1:19421/'+$path)
  $shell.SendKeys('{ENTER}')
}
function RedirectSettings([int]$index,[bool]$allowlist=$false) {
  Activate (WaitElement '^Preferences(?: SETTINGS.*)?$' 20 'Button')
  Activate (WaitElement "^Discover(?: Discover's .*)?$" 20 'Button')
  $combo=WaitElement '^Automatic redirects$' 20 'ComboBox'
  $combo.SetFocus()
  $shell.SendKeys('%{DOWN}{HOME}')
  if($index){$shell.SendKeys(('{DOWN}' * $index))}
  $shell.SendKeys('{ENTER}')
  if($allowlist){
    $field=WaitElement '^Allow redirects from$' 20 'Edit'
    $field.SetFocus()
    $shell.SendKeys('127.0.0.1')
    Activate (WaitElement '^Add site$' 20 'Button')
    $null=WaitElement '^Remove 127\.0\.0\.1$' 20 'Button'
  }
  Activate (WaitElement '^Discover FIND NEW BOOKS$' 20 'Button')
}
function SaveEvidence {
  try {
    $window=AppWindow
    if($window){
      $window.FindAll($scope,$any) | ForEach-Object {
        try { '{0}: {1}' -f $_.Current.ControlType.ProgrammaticName,$_.Current.Name } catch {}
      } | Set-Content (Join-Path $out 'ui-tree.txt')
    }
    $screen=[Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp=New-Object Drawing.Bitmap($screen.Width,$screen.Height)
    $graphics=[Drawing.Graphics]::FromImage($bmp)
    $graphics.CopyFromScreen($screen.Location,[Drawing.Point]::Empty,$screen.Size)
    $bmp.Save((Join-Path $out 'desktop.png'),[Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bmp.Dispose()
  } catch { Write-Warning $_ }
}
try {
  $discover=WaitElement '^Discover(?: .*)?$' 45
  Write-Host 'Installed app accessibility tree is reachable'
  Activate $discover
  Start-Sleep -Milliseconds 500
  $null=$shell.AppActivate($app.Id)
  $shell.SendKeys('^k')
  $shell.SendKeys('http://127.0.0.1:19421/slow.epub')
  $shell.SendKeys('{ENTER}')
  $null=WaitElement '^Downloads, 1 in progress$'
  Write-Host 'Live download started'
  Activate (WaitElement '^Archive(?: .*)?$')
  Activate (WaitElement '^Discover(?: .*)?$')
  Activate (WaitElement '^Downloads, 1 in progress$')
  $null=WaitElement 'Coming down'
  if(FindElement '^Retry$'){throw 'Active transfer showed Retry'}
  Activate (WaitElement '^Cancel$')
  $deadline=(Get-Date).AddSeconds(15)
  do {
    $log=Get-Content (Join-Path $out 'http.log') -Raw
    $folders=@(Get-ChildItem -LiteralPath $stage -Directory -ErrorAction SilentlyContinue)
    if($log -match 'slow connection closed' -and !$folders.Count){break}
    Start-Sleep -Milliseconds 250
  } while((Get-Date) -lt $deadline)
  if($log -notmatch 'slow connection closed' -or $folders.Count){throw 'Cancellation did not close the connection and clear staging'}
  Write-Host 'Native Windows transfer stayed active across navigation, then cancellation closed the connection and removed staging'
  $shell.SendKeys('{ESC}')
  GoTo 'redirect'
  $null=WaitElement '^Redirect reached$'
  Write-Host 'Default redirect policy allowed the real HTTP redirect'
  RedirectSettings 1
  GoTo 'block-entry'
  $null=WaitElement 'Redirect blocked' 12
  if((Get-Content (Join-Path $out 'http.log') -Raw) -match 'GET /block-target'){throw 'Block mode reached the destination'}
  RedirectSettings 2
  GoTo 'ask-entry'
  Activate (WaitElement '^Allow once$' 20 'Button')
  $null=WaitElement '^Policy reached ask$'
  RedirectSettings 1 $true
  GoTo 'allowlist-entry'
  $null=WaitElement '^Policy reached allowlist$'
  Write-Host 'Windows reject, ask/allow once and source allowlist passed against real HTTP redirects'
  RedirectSettings 0
  GoTo 'popup'
  Activate (WaitElement '^Download now$')
  $null=WaitElement '^Downloads, 1 in progress$'
  Write-Host 'A real sized popup download reached the Discover indicator'
  SaveEvidence
} catch {
  SaveEvidence
  throw
} finally {
  Stop-Process -Id $server.Id,$app.Id -ErrorAction SilentlyContinue
}
