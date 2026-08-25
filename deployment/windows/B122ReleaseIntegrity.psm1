Set-StrictMode -Version Latest

function Invoke-B122ReleaseGit {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $result = @(& git.exe -C $RepositoryRoot -c core.excludesFile= @Arguments 2>&1)
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

Export-ModuleMember -Function Get-B122ReleaseSourceCommit, Assert-B122ReleaseSourceState
