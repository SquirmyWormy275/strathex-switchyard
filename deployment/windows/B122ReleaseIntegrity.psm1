Set-StrictMode -Version Latest

function Get-B122ReleaseGitExecutable {
  $programFiles=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
  $git=[IO.Path]::GetFullPath((Join-Path $programFiles 'Git\cmd\git.exe'))
  if(-not(Test-Path -LiteralPath $git -PathType Leaf)){throw 'The fixed Program Files Git executable is unavailable.'}
  $item=Get-Item -LiteralPath $git -Force
  if($item.PSIsContainer-or($item.Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'The fixed Program Files Git executable is unsafe.'}
  return $git
}

function Invoke-B122ReleaseGit {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $git=Get-B122ReleaseGitExecutable
  $result = @(& $git -C $RepositoryRoot -c core.excludesFile= @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    $detail = ($result | ForEach-Object { [string]$_ }) -join "`n"
    throw "Release source-control query failed: $detail"
  }
  return (($result | ForEach-Object { [string]$_ }) -join "`n").Trim()
}

function Get-B122ReleaseSourceCommit {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$RepositoryRoot)

  $commit = Invoke-B122ReleaseGit -RepositoryRoot $RepositoryRoot -Arguments @('rev-parse', '--verify', 'HEAD^{commit}')
  if ($commit -cnotmatch '^[0-9a-f]{40}$') { throw 'Release source HEAD is not an exact Git commit.' }
  return $commit
}

function Assert-B122ReleaseSourceState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{40}$')][string]$ExpectedCommit
  )

  $actualCommit = Get-B122ReleaseSourceCommit -RepositoryRoot $RepositoryRoot
  if ($actualCommit -cne $ExpectedCommit) {
    throw "Release source HEAD changed from $ExpectedCommit to $actualCommit."
  }
  $status = Invoke-B122ReleaseGit -RepositoryRoot $RepositoryRoot -Arguments @('status', '--porcelain=v1', '--untracked-files=all')
  if (-not [string]::IsNullOrWhiteSpace($status)) {
    throw "Release source worktree is not clean (tracked, staged, or untracked content is present):`n$status"
  }
  return $actualCommit
}

function Assert-B122VsixIdentity {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$VsixPath,
    [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$ExpectedVersion,
    [string]$ExpectedId='strathex-switchyard-b122',
    [string]$ExpectedPublisher='SquirmyWormy275'
  )
  $path=[IO.Path]::GetFullPath($VsixPath);$item=Get-Item -LiteralPath $path -Force
  if($item.PSIsContainer-or($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-or$item.Length-lt64-or$item.Length-gt256MB){throw 'The VSIX is not one bounded concrete archive.'}
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive=[IO.Compression.ZipFile]::OpenRead($path)
  try{
    foreach($entryName in @('extension.vsixmanifest','[Content_Types].xml','extension/package.json','extension/dist/apps/vscode-extension/src/extension.js')){if(@($archive.Entries|Where-Object{$_.FullName-ceq$entryName}).Count-ne1){throw "VSIX entry is missing or duplicated: $entryName"}}
    function Read-B122VsixText([string]$EntryName,[long]$MaximumBytes){$entry=@($archive.Entries|Where-Object{$_.FullName-ceq$EntryName})[0];if($entry.Length-lt2-or$entry.Length-gt$MaximumBytes){throw "VSIX text entry is outside its size bound: $EntryName"};$stream=$entry.Open();$reader=New-Object IO.StreamReader($stream,(New-Object Text.UTF8Encoding($false,$true)),$true);try{return $reader.ReadToEnd()}finally{$reader.Dispose();$stream.Dispose()}}
    $package=(Read-B122VsixText 'extension/package.json' 1MB)|ConvertFrom-Json
    if($package.name-cne$ExpectedId-or$package.publisher-cne$ExpectedPublisher-or$package.version-cne$ExpectedVersion-or$package.main-cne'./dist/apps/vscode-extension/src/extension.js'){throw 'The archived VS Code package identity does not match the reviewed release identity.'}
    $manifestText=Read-B122VsixText 'extension.vsixmanifest' 256KB;$settings=New-Object Xml.XmlReaderSettings;$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit;$settings.XmlResolver=$null;$reader=[Xml.XmlReader]::Create((New-Object IO.StringReader($manifestText)),$settings);$manifest=New-Object Xml.XmlDocument;$manifest.XmlResolver=$null;try{$manifest.Load($reader)}finally{$reader.Dispose()}
    $namespace=New-Object Xml.XmlNamespaceManager($manifest.NameTable);$namespace.AddNamespace('v','http://schemas.microsoft.com/developer/vsx-schema/2011');$identities=@($manifest.SelectNodes('/v:PackageManifest/v:Metadata/v:Identity',$namespace));if($identities.Count-ne1){throw 'The VSIX manifest does not contain exactly one package identity.'};$identity=$identities[0]
    if((@($identity.Attributes|ForEach-Object{[string]$_.Name}|Sort-Object)-join',')-cne'Id,Language,Publisher,Version'-or$identity.Id-cne$ExpectedId-or$identity.Publisher-cne$ExpectedPublisher-or$identity.Version-cne$ExpectedVersion-or$identity.Language-cne'en-US'){throw 'The VSIX manifest identity does not match the archived package and release metadata.'}
    return [pscustomobject][ordered]@{id=$ExpectedId;publisher=$ExpectedPublisher;version=$ExpectedVersion;main='./dist/apps/vscode-extension/src/extension.js'}
  }finally{$archive.Dispose()}
}

Export-ModuleMember -Function Get-B122ReleaseSourceCommit, Assert-B122ReleaseSourceState, Assert-B122VsixIdentity
