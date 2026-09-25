param(
  [string]$OutputName = "Chess-Vela-project-export-$(Get-Date -Format 'yyyyMMdd-HHmmss').zip"
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$exportRoot = Join-Path $root '.export-staging'
$outputDir = Join-Path $root 'archive/exports'
$staging = Join-Path $exportRoot ([IO.Path]::GetFileNameWithoutExtension($OutputName))

if (Test-Path -LiteralPath $staging) {
  Remove-Item -LiteralPath $staging -Recurse -Force
}
New-Item -ItemType Directory -Path $staging,$outputDir -Force | Out-Null

function Copy-IfExists([string]$relativePath) {
  $source = Join-Path $root $relativePath
  if (Test-Path -LiteralPath $source) {
    $destination = Join-Path $staging $relativePath
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
  }
}

function Copy-Skill([string]$sourcePath, [string]$skillName) {
  if (Test-Path -LiteralPath $sourcePath) {
    $destination = Join-Path $staging (Join-Path 'skill-exports' $skillName)
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $destination 'SKILL.md') -Force
  }
}

Copy-IfExists 'src'
Copy-IfExists 'archive/dist'
Copy-IfExists 'README.md'
Copy-IfExists 'package.json'
Copy-IfExists 'package-lock.json'
Copy-IfExists '.npmrc'
Copy-IfExists 'jsconfig.json'
Copy-IfExists 'docs/PROJECT_OVERVIEW.md'
Copy-IfExists 'docs/PROJECT_SKILLS.md'
Copy-IfExists 'docs/CONVERSATION_CHANGELOG.md'
Copy-IfExists 'docs/AVAILABLE_SKILLS.md'
Copy-IfExists 'tools/package_export.ps1'

# Export the callable Skill entry documents for project handoff.
Copy-Skill 'C:\Users\HP\.codex\skills\.system\imagegen\SKILL.md' 'imagegen'
Copy-Skill 'C:\Users\HP\.codex\skills\.system\openai-docs\SKILL.md' 'openai-docs'
Copy-Skill 'C:\Users\HP\.codex\skills\.system\plugin-creator\SKILL.md' 'plugin-creator'
Copy-Skill 'C:\Users\HP\.codex\skills\.system\skill-creator\SKILL.md' 'skill-creator'
Copy-Skill 'C:\Users\HP\.codex\skills\.system\skill-installer\SKILL.md' 'skill-installer'
Copy-Skill 'C:\Users\HP\.codex\skills\vela-quickapp-dev\vela-quickapp-dev\SKILL.md' 'vela-quickapp-dev'
Copy-Skill 'C:\Users\HP\.codex\skills\vela-watch-design\SKILL.md' 'vela-watch-design'
Copy-Skill 'C:\Users\HP\.codex\plugins\cache\openai-bundled\computer-use\26.915.31945\skills\computer-use\SKILL.md' 'computer-use'
Copy-Skill 'C:\Users\HP\.codex\plugins\cache\openai-bundled\visualize\1.0.38\skills\visualize\SKILL.md' 'visualize'
Copy-Skill 'C:\Users\HP\.codex\plugins\cache\openai-curated-remote\plugin-management\0.1.0\skills\plugin-management\SKILL.md' 'plugin-management'
Copy-Skill 'C:\Users\HP\.codex\plugins\cache\openai-primary-runtime\documents\26.904.11930\skills\documents\SKILL.md' 'documents'
Copy-Skill 'C:\Users\HP\.codex\plugins\cache\openai-primary-runtime\pdf\26.904.11930\skills\pdf\SKILL.md' 'pdf'
Copy-Skill 'C:\Users\HP\.codex\plugins\cache\openai-primary-runtime\presentations\26.904.11930\skills\presentations\SKILL.md' 'presentations'
Copy-Skill 'C:\Users\HP\.codex\plugins\cache\openai-primary-runtime\spreadsheets\26.904.11930\skills\spreadsheets\SKILL.md' 'spreadsheets'
Copy-Skill 'C:\Users\HP\.codex\plugins\cache\openai-primary-runtime\spreadsheets\26.904.11930\skills\excel-live-control\SKILL.md' 'excel-live-control'
Copy-Skill 'C:\Users\HP\.codex\plugins\cache\openai-primary-runtime\template-creator\26.904.11930\skills\template-creator\SKILL.md' 'template-creator'

$zipPath = Join-Path $outputDir $OutputName
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
tar.exe -a -c -f $zipPath -C $staging .
Write-Host "Export created: $zipPath"
