#Requires -Version 7
<#
.SYNOPSIS
  Resolve and ensure the SDD workspace directory for one plan.
.DESCRIPTION
  PowerShell port of the superpowers:subagent-driven-development
  scripts/sdd-workspace helper: one directory per plan at
  <repo-root>/.superpowers/sdd/<plan-basename>/. Prints the absolute path.

  Upstream keeps that workspace out of git by writing a one-line `.gitignore`
  holding `*`. This repository keeps its record instead -- the phase directories
  are negated back in and committed, which is the decision AGENTS.md records --
  so the ignore file is created ONLY when it is missing. Overwriting it would
  silently hide every phase from git, and the negations the current file carries
  are exactly what a second run used to destroy.
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

$ignore = Join-Path $base '.gitignore'
if (-not (Test-Path -LiteralPath $ignore)) {
  Set-Content -LiteralPath $ignore -Value '*' -NoNewline
}

Write-Output $dir
