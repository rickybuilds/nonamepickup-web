param(
    [string]$HalfLifeRoot = 'C:\Program Files (x86)\Steam\steamapps\common\Half-Life',
    [string]$Destination = (Join-Path $env:TEMP 'noname-hltv-assets.zip'),
    [string[]]$Maps = @('2trof_b4')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceRoot = (Resolve-Path -LiteralPath $HalfLifeRoot).Path.TrimEnd('\')
$archivePath = [IO.Path]::GetFullPath($Destination)
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')).TrimEnd('\')
if ($archivePath.StartsWith($repositoryRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Keep game assets outside the Git repository.' }
if (Test-Path -LiteralPath $archivePath) { throw "Archive already exists: $archivePath. Choose another destination." }
foreach ($mapName in $Maps) { if ($mapName -ne '*' -and $mapName -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid map name.' } }
$files = [Collections.Generic.List[IO.FileInfo]]::new()
foreach ($folderName in @('valve', 'tfc', 'tfc_downloads', 'tfc_addon')) {
    $folderPath = Join-Path $sourceRoot $folderName
    if (!(Test-Path -LiteralPath $folderPath)) { continue }
    if ((Get-Item -LiteralPath $folderPath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Symlink/junction asset folders are not supported.' }
    Get-ChildItem -LiteralPath $folderPath -File -Recurse | ForEach-Object {
        $relativePath = $_.FullName.Substring($folderPath.Length + 1).Replace('\', '/')
        $needed = ($_.Extension -ieq '.wad' -and !$relativePath.Contains('/')) -or
            ($relativePath.StartsWith('models/') -and $_.Extension -ieq '.mdl') -or
            ($relativePath.StartsWith('maps/') -and $_.Extension -ieq '.bsp' -and ($Maps -contains '*' -or $Maps -contains $_.BaseName))
        if ($needed) {
            if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Symlink asset files are not supported.' }
            $files.Add($_)
        }
    }
}
if (!$files.Count) { throw 'No matching map/model assets found.' }
$archive = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $files) {
        $entryName = $file.FullName.Substring($sourceRoot.Length + 1).Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }
Get-Item -LiteralPath $archivePath | Select-Object FullName, Length
Write-Output "Packed $($files.Count) private asset files. Upload privately; do not commit or publish this archive."
