#Requires -Version 7
<#
.SYNOPSIS
  Extract one task's full text from an implementation plan into a brief file.
.DESCRIPTION
  PowerShell port of the superpowers:subagent-driven-development
  scripts/task-brief helper. A task's section runs from its own `## Task N:`
  heading up to the next task heading, and headings inside fenced code blocks
  are ignored so plan text that quotes markdown cannot truncate a brief.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory, Position = 0)][string]$PlanFile,
  [Parameter(Mandatory, Position = 1)][int]$TaskNumber,
  [Parameter(Position = 2)][string]$OutFile
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PlanFile -PathType Leaf)) {
  Write-Error "no such plan file: $PlanFile"
  exit 2
}

if (-not $OutFile) {
  $dir = & (Join-Path $PSScriptRoot 'sdd-workspace.ps1') $PlanFile
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $OutFile = Join-Path $dir "task-$TaskNumber-brief.md"
}

$lines = [System.IO.File]::ReadAllLines($PlanFile)
$collected = [System.Collections.Generic.List[string]]::new()
$inFence = $false
$inTask = $false

foreach ($line in $lines) {
  # A plan may wrap fences in different languages; any line starting with ```
  # toggles fence state, matching the awk implementation.
  if ($line -match '^```') { $inFence = -not $inFence }

  if (-not $inFence -and $line -match '^#+[ \t]+Task[ \t]+([0-9]+)') {
    $heading = [int]$Matches[1]
    $inTask = ($heading -eq $TaskNumber)
  }

  if ($inTask) { $collected.Add($line) }
}

if ($collected.Count -eq 0) {
  Write-Error "task $TaskNumber not found in ${PlanFile} (no heading matching 'Task $TaskNumber')"
  exit 3
}

$parent = Split-Path -Parent $OutFile
if ($parent -and -not (Test-Path -LiteralPath $parent)) {
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
}
[System.IO.File]::WriteAllLines($OutFile, $collected)
Write-Output "wrote ${OutFile}: $($collected.Count) lines"
