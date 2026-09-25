#Requires -Version 7
<#
.SYNOPSIS
  Generate a review package (commit list, stat summary, extended-context diff).
.DESCRIPTION
  PowerShell port of the superpowers:subagent-driven-development
  scripts/review-package helper. Uses the per-task BASE recorded by the
  controller rather than HEAD~1 so multi-commit tasks stay intact.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory, Position = 0)][string]$PlanFile,
  [Parameter(Mandatory, Position = 1)][string]$Base,
  [Parameter(Mandatory, Position = 2)][string]$Head,
  [Parameter(Position = 3)][string]$OutFile
)

$ErrorActionPreference = 'Stop'

# git emits nothing for an empty range, and PowerShell then hands back $null
# rather than an empty collection -- which List.AddRange rejects. Collect
# defensively so a same-revision range produces an empty section, not a crash.
function Add-Lines {
  param(
    [System.Collections.Generic.List[string]]$Target,
    [AllowNull()]$Lines
  )
  if ($null -eq $Lines) { return }
  foreach ($line in @($Lines)) {
    if ($null -ne $line) { $Target.Add([string]$line) }
  }
}

if (-not (Test-Path -LiteralPath $PlanFile -PathType Leaf)) {
  Write-Error "no such plan file: $PlanFile"
  exit 2
}

foreach ($rev in @($Base, $Head)) {
  & git rev-parse --verify --quiet $rev > $null 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Error "bad revision: $rev"
    exit 2
  }
}

if (-not $OutFile) {
  $dir = & (Join-Path $PSScriptRoot 'sdd-workspace.ps1') $PlanFile
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $shortBase = (& git rev-parse --short $Base).Trim()
  $shortHead = (& git rev-parse --short $Head).Trim()
  $OutFile = Join-Path $dir "review-$shortBase..$shortHead.diff"
}

$body = [System.Collections.Generic.List[string]]::new()
$body.Add("# Review package: $Base..$Head")
$body.Add('')
$body.Add('## Commits')
Add-Lines $body (& git log --oneline "$Base..$Head")
$body.Add('')
$body.Add('## Files changed')
Add-Lines $body (& git diff --stat "$Base..$Head")
$body.Add('')
$body.Add('## Diff')
Add-Lines $body (& git diff -U10 "$Base..$Head")

$parent = Split-Path -Parent $OutFile
if ($parent -and -not (Test-Path -LiteralPath $parent)) {
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
}
[System.IO.File]::WriteAllLines($OutFile, $body)

$commits = (& git rev-list --count "$Base..$Head").Trim()
$bytes = (Get-Item -LiteralPath $OutFile).Length
Write-Output "wrote ${OutFile}: $commits commit(s), $bytes bytes"
