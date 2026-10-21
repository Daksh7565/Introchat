<#
.SYNOPSIS
  M0 Phase 7: send OTP-style test SMS through the SIM gateway phone and measure delivery.

.DESCRIPTION
  Uses the SMS Gateway for Android cloud API (https://docs.sms-gate.app):
    POST /3rdparty/v1/messages        send
    GET  /3rdparty/v1/messages/{id}   state: Pending -> Processed -> Sent -> Delivered | Failed
  For each number it records how long the operator took to accept (Sent) and to
  deliver (Delivered, from the delivery report).

  Asks for the gateway credentials when run; they are never written anywhere.
  Results go to documents\field-tests\raw\ (git-ignored) with phone numbers
  masked to the last 4 digits.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\sms-check\send-test.ps1
#>
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ApiBase = 'https://api.sms-gate.app/3rdparty/v1/messages'
$PollSeconds = 5
$GiveUpAfterSeconds = 180
$Terminal = @('Delivered', 'Failed', 'Cancelled')

# --- Credentials (from the app: Settings -> Cloud server) -------------------
$user = Read-Host 'Gateway username'
$securePass = Read-Host 'Gateway password' -AsSecureString
$plainPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePass))
$authHeader = @{
  Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${user}:${plainPass}"))
}
Remove-Variable plainPass

# --- Recipients --------------------------------------------------------------
Write-Host ''
Write-Host 'Enter recipients as Operator=+91XXXXXXXXXX, separated by commas.'
Write-Host 'Example: Jio=+919800000001, Airtel=+919800000002, Vi=+919800000003, BSNL=+919800000004'
$raw = Read-Host 'Recipients'
$recipients = @()
foreach ($part in $raw.Split(',')) {
  $pair = $part.Trim().Split('=')
  if ($pair.Count -ne 2 -or $pair[1].Trim() -notmatch '^\+91[6-9]\d{9}$') {
    throw "Not a valid entry: '$($part.Trim())'. Use Operator=+91 followed by 10 digits."
  }
  $recipients += [pscustomobject]@{ Operator = $pair[0].Trim(); Phone = $pair[1].Trim() }
}
Write-Host "This sends $($recipients.Count) SMS from the SIM. Make sure the gateway app is running." -ForegroundColor Yellow
if ((Read-Host 'Continue? (y/n)') -ne 'y') { exit 1 }

function Mask([string]$phone) { '******' + $phone.Substring($phone.Length - 4) }

function Get-StateTime($message, [string]$state) {
  if ($null -eq $message.states) { return $null }
  $value = $message.states.$state
  if ($null -eq $value) { return $null }
  return ([datetime]::Parse($value)).ToUniversalTime()
}

# --- Send --------------------------------------------------------------------
$sent = @()
foreach ($r in $recipients) {
  # Looks like a real OTP (operators and phones treat OTP-shaped SMS differently)
  # but says plainly that it is a test.
  $code = Get-Random -Minimum 100000 -Maximum 999999
  $body = @{
    textMessage  = @{ text = "$code is your IntroChat test code. This is a test, please ignore." }
    phoneNumbers = @($r.Phone)
  } | ConvertTo-Json -Depth 4
  $startedAt = (Get-Date).ToUniversalTime()
  try {
    $response = Invoke-RestMethod -Method Post -Uri $ApiBase -Headers $authHeader `
      -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
  } catch {
    Write-Host "$($r.Operator) $(Mask $r.Phone): send request failed: $($_.Exception.Message)" -ForegroundColor Red
    $sent += [pscustomobject]@{ Operator = $r.Operator; Phone = $r.Phone; Id = $null; StartedAt = $startedAt; Error = $_.Exception.Message }
    continue
  }
  if (-not $response.id) {
    # The API changed shape; stop instead of measuring nothing.
    throw "Send response has no 'id'. Raw response: $($response | ConvertTo-Json -Depth 6 -Compress)"
  }
  Write-Host "$($r.Operator) $(Mask $r.Phone): queued as $($response.id)"
  $sent += [pscustomobject]@{ Operator = $r.Operator; Phone = $r.Phone; Id = $response.id; StartedAt = $startedAt; Error = $null }
}

# --- Poll until delivered / failed / give up ----------------------------------
$results = @{}
$deadline = (Get-Date).AddSeconds($GiveUpAfterSeconds)
do {
  Start-Sleep -Seconds $PollSeconds
  $pending = 0
  foreach ($s in $sent | Where-Object { $_.Id }) {
    if ($results.ContainsKey($s.Id) -and $Terminal -contains $results[$s.Id].state) { continue }
    try {
      $results[$s.Id] = Invoke-RestMethod -Method Get -Uri "$ApiBase/$($s.Id)" -Headers $authHeader
    } catch {
      Write-Host "Status check failed for $($s.Id): $($_.Exception.Message)" -ForegroundColor Yellow
    }
    if (-not ($results.ContainsKey($s.Id) -and $Terminal -contains $results[$s.Id].state)) { $pending++ }
  }
  Write-Host "Waiting for delivery reports... $pending still open"
} while ($pending -gt 0 -and (Get-Date) -lt $deadline)

# --- Report ------------------------------------------------------------------
$rows = foreach ($s in $sent) {
  $m = if ($s.Id) { $results[$s.Id] } else { $null }
  $sentAt = if ($m) { Get-StateTime $m 'Sent' } else { $null }
  $deliveredAt = if ($m) { Get-StateTime $m 'Delivered' } else { $null }
  [pscustomobject]@{
    operator            = $s.Operator
    phone               = Mask $s.Phone
    final_state         = if ($s.Error) { 'SendRequestFailed' } elseif ($m) { $m.state } else { 'NoStatus' }
    seconds_to_sent     = if ($sentAt) { [math]::Round(($sentAt - $s.StartedAt).TotalSeconds, 1) } else { '' }
    seconds_to_delivered = if ($deliveredAt) { [math]::Round(($deliveredAt - $s.StartedAt).TotalSeconds, 1) } else { '' }
    note                = if ($s.Error) { $s.Error } elseif ($m -and $m.state -eq 'Sent') { 'No delivery report: ask the recipient when it arrived' } else { '' }
  }
}
$rows | Format-Table -AutoSize

$outDir = Join-Path $PSScriptRoot '..\..\documents\field-tests\raw'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir ("sms-check-{0}.csv" -f (Get-Date -Format 'yyyy-MM-dd-HHmm'))
$rows | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $outFile
Write-Host "Saved (numbers masked): $outFile" -ForegroundColor Green
