[CmdletBinding(SupportsShouldProcess=$true,ConfirmImpact='High')]
param(
  [string]$ClaudeDesktopPath,
  [string]$ChatGptDesktopPath,
  [string]$ClaudeCodePath,
  [string]$CodexPath,
  [string]$OutputPath
)
$ErrorActionPreference='Stop'
$output = if($OutputPath){[IO.Path]::GetFullPath($OutputPath)}else{Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'STRATHEX\switchyard\provider-desktop-paths.json'}
$configured = [ordered]@{}
$receipts = [ordered]@{}
$inputs = [ordered]@{claude_desktop=$ClaudeDesktopPath;chatgpt_desktop=$ChatGptDesktopPath;claude_code=$ClaudeCodePath;codex=$CodexPath}
foreach($entry in $inputs.GetEnumerator()){
  if([string]::IsNullOrWhiteSpace([string]$entry.Value)){continue}
  $path=[IO.Path]::GetFullPath([string]$entry.Value)
  if($path.Length -gt 160 -or $path -notmatch '^[A-Za-z]:[\\/]' -or $path -match '^(?:\\\\|//|\\\\\?\\|\\\\\.\\)' -or -not [IO.Path]::GetExtension($path).Equals('.exe',[StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $path -PathType Leaf)){throw "The fixed $($entry.Key) path must name one bounded local existing .exe file."}
  $item=Get-Item -LiteralPath $path -Force
  if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.Length -le 0 -or $item.Length -gt 2GB){throw "The fixed $($entry.Key) path is linked, empty, or oversized."}
  $signature=Get-AuthenticodeSignature -LiteralPath $path
  if($signature.Status -cne 'Valid' -or $null -eq $signature.SignerCertificate){throw "The fixed $($entry.Key) executable must have a valid timestamp-aware Authenticode signature."}
  $subject=[string]$signature.SignerCertificate.Subject
  $thumbprint=([string]$signature.SignerCertificate.Thumbprint).Replace(' ','').ToLowerInvariant()
  if([string]::IsNullOrWhiteSpace($subject) -or $subject.Length -gt 512 -or $thumbprint -notmatch '^[a-f0-9]{40,128}$'){throw "The fixed $($entry.Key) Authenticode signer identity is invalid."}
  $configured[$entry.Key]=[ordered]@{path=$path;signerSubject=$subject;signerThumbprint=$thumbprint}
  $receipts[$entry.Key]=[ordered]@{path=$path;sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();bytes=$item.Length;signerSubject=$subject;signerThumbprint=$thumbprint}
}
if($configured.Count -eq 0){throw 'Configure at least one fixed Claude Desktop, ChatGPT Desktop, Claude Code, or Codex executable.'}
if(Test-Path -LiteralPath $output){$current=Get-Item -LiteralPath $output -Force;if(($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'The provider path configuration destination cannot be a reparse point.'}}
$parent=[IO.Path]::GetDirectoryName($output);New-Item -ItemType Directory -Path $parent -Force|Out-Null
if(-not $PSCmdlet.ShouldProcess($output,'Install fixed provider executable path configuration; each provider still requires separate Windows user-presence approval')){return}
$record=[ordered]@{schema='sxsy-b122.provider-desktop-paths';version=2;providers=$configured}
$temporary=Join-Path $parent ('.provider-desktop-paths.'+[Guid]::NewGuid().ToString('N')+'.tmp')
try{
  [IO.File]::WriteAllText($temporary,($record|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $output -Force
}finally{Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue}
[ordered]@{schema='sxsy-b122.provider-desktop-paths-install';version=1;status='installed';outputPath=$output;providers=$receipts}|ConvertTo-Json -Depth 6 -Compress
