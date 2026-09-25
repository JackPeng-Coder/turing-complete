#Requires -Version 7
<#
.SYNOPSIS
  Resolve and ensure the SDD workspace directory for one plan.
.DESCRIPTION
  PowerShell port of the superpowers:subagent-driven-development
  scripts/sdd-workspace helper, with identical semantics: one directory per
  plan at <repo-root>/.superpowers/sdd/<plan-basename>/, kept out of git by a
  self-ignoring .gitignore in the parent directory. Prints the absolute path.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory, Position = 0)][string]$PlanFile
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PlanFile -PathType Leaf)) {
  Write-Error "no such plan file: $PlanFile"
  exit 2
}

$slug = [System.IO.Path]::GetFileNameWithoutExtension($PlanFile)
if ([string]::IsNullOrWhiteSpace($slug) -or $slug -eq '.' -or $slug -eq '..') {
  Write-Error "cannot derive a workspace name from: $PlanFile"
  exit 2
}

$root = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($root)) {
  Write-Error 'not inside a git working tree'
  exit 2
}

$base = Join-Path $root '.superpowers/sdd'
$dir = Join-Path $base $slug
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Content -LiteralPath (Join-Path $base '.gitignore') -Value '*' -NoNewline
Write-Output $dir
