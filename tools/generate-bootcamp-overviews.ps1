param(
    [Parameter(Mandatory = $true)]
    [string]$GameDirectory,
    [string]$ManifestPath = (Join-Path $PSScriptRoot '../assets/data/bootcamp-overviews.json'),
    [string]$ImageDirectory = (Join-Path $PSScriptRoot '../assets/images/bootcamp-overviews')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$overviewDirectory = Join-Path $GameDirectory 'overviews'
$mapDirectory = Join-Path $GameDirectory 'maps'
if (-not (Test-Path -LiteralPath $overviewDirectory -PathType Container) -or -not (Test-Path -LiteralPath $mapDirectory -PathType Container)) {
    throw 'GameDirectory must contain overviews and maps directories.'
}

$maps = [ordered]@{}
foreach ($bmpFile in (Get-ChildItem -LiteralPath $overviewDirectory -Filter '*.bmp' | Sort-Object Name)) {
    $name = $bmpFile.BaseName.ToLowerInvariant()
    $txtPath = Join-Path $overviewDirectory "$name.txt"
    $bspPath = Join-Path $mapDirectory "$name.bsp"
    if (-not (Test-Path -LiteralPath $txtPath -PathType Leaf) -or -not (Test-Path -LiteralPath $bspPath -PathType Leaf)) { continue }

    $overviewText = Get-Content -LiteralPath $txtPath -Raw
    $zoomMatch = [regex]::Match($overviewText, '(?im)^\s*ZOOM\s+(-?[\d.]+)')
    $originMatch = [regex]::Match($overviewText, '(?im)^\s*ORIGIN\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)')
    $rotatedMatch = [regex]::Match($overviewText, '(?im)^\s*ROTATED\s+([01])')
    if (-not $zoomMatch.Success -or -not $originMatch.Success -or -not $rotatedMatch.Success) { throw "Overview metadata is incomplete for $name." }
    $zoom = [double]::Parse($zoomMatch.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
    $origin = @(
        [double]::Parse($originMatch.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture),
        [double]::Parse($originMatch.Groups[2].Value, [Globalization.CultureInfo]::InvariantCulture),
        [double]::Parse($originMatch.Groups[3].Value, [Globalization.CultureInfo]::InvariantCulture)
    )
    $rotated = [int]$rotatedMatch.Groups[1].Value

    $stream = [IO.File]::OpenRead($bspPath)
    try {
        $reader = [IO.BinaryReader]::new($stream)
        $bspVersion = $reader.ReadInt32()
        if ($bspVersion -ne 30) { throw "Unsupported BSP version $bspVersion for $name; expected GoldSrc BSP v30." }
        $stream.Position = 4 + 14 * 8
        $modelOffset = $reader.ReadInt32()
        $modelLength = $reader.ReadInt32()
        if ($modelLength -lt 64 -or $modelLength % 64 -ne 0) { throw "Invalid world-model lump for $name." }
        $stream.Position = $modelOffset
        $world = @()
        for ($i = 0; $i -lt 6; $i++) { $world += [double]$reader.ReadSingle() }
    }
    finally { $stream.Dispose() }
    $worldBounds = [ordered]@{
        minX = $world[0]; minY = $world[1]; minZ = $world[2]
        maxX = $world[3]; maxY = $world[4]; maxZ = $world[5]
    }
    $worldSpanX = $worldBounds.maxX - $worldBounds.minX
    $worldSpanY = $worldBounds.maxY - $worldBounds.minY
    if ($worldSpanX -le 0 -or $worldSpanY -le 0) { throw "World-model bounds are empty for $name." }

    $source = [System.Drawing.Bitmap]::new($bmpFile.FullName)
    $imageWidth = $source.Width
    $imageHeight = $source.Height
    $target = [System.Drawing.Bitmap]::new($imageWidth, $imageHeight, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $left = $source.Width
        $top = $source.Height
        $right = -1
        $bottom = -1
        for ($y = 0; $y -lt $source.Height; $y++) {
            for ($x = 0; $x -lt $source.Width; $x++) {
                $pixel = $source.GetPixel($x, $y)
                if ($pixel.R -eq 0 -and $pixel.G -eq 255 -and $pixel.B -eq 0) {
                    $target.SetPixel($x, $y, [Drawing.Color]::FromArgb(0, 0, 255, 0))
                }
                else {
                    $target.SetPixel($x, $y, $pixel)
                    if ($x -lt $left) { $left = $x }
                    if ($x -gt $right) { $right = $x }
                    if ($y -lt $top) { $top = $y }
                    if ($y -gt $bottom) { $bottom = $y }
                }
            }
        }

        if ($right -le $left -or $bottom -le $top) { throw "The overview image has no usable non-key pixels: $name." }
        $pixelPerUnit = $imageWidth * $zoom / 8192.0
        if ($rotated) {
            # GoldSrc ROTATED=1 maps image right to world +X and image down to world -Y.
            $a = $pixelPerUnit
            $b = 0.0
            $c = $imageWidth / 2.0 - $a * $origin[0]
            $d = 0.0
            $e = -$pixelPerUnit
            $f = $imageHeight / 2.0 + $pixelPerUnit * $origin[1]
        }
        else {
            # ROTATED=0 turns the overview axes: image right maps to world -Y and image down to world -X.
            $a = 0.0
            $b = -$pixelPerUnit
            $c = $imageWidth / 2.0 + $pixelPerUnit * $origin[1]
            $d = -$pixelPerUnit
            $e = 0.0
            $f = $imageHeight / 2.0 + $pixelPerUnit * $origin[0]
        }

        $imagePath = Join-Path $ImageDirectory "$name.png"
        New-Item -ItemType Directory -Force -Path $ImageDirectory | Out-Null
        $target.Save($imagePath, [Drawing.Imaging.ImageFormat]::Png)
        $maps[$name] = [ordered]@{
            image = "/assets/images/bootcamp-overviews/$name.png"
            width = $imageWidth
            height = $imageHeight
            transform = @($a, $b, $c, $d, $e, $f)
            transformSource = [ordered]@{
                format = 'GoldSrc overview projection from ZOOM/ORIGIN/ROTATED; BSP v30 bounds and transparent-key bounds retained for audit'
                overview = [ordered]@{ zoom = $zoom; origin = $origin; rotated = $rotated }
                worldBounds = $worldBounds
                contentBounds = [ordered]@{ left = $left; top = $top; right = $right; bottom = $bottom }
            }
        }
    }
    finally {
        $source.Dispose()
        $target.Dispose()
    }
    Write-Output "$name`: ${imageWidth}x${imageHeight}, rotated=$rotated, bounds=[$left,$top]-[$right,$bottom]"
}

if ($maps.Count -eq 0) { throw 'No maps had a matching BSP, overview text file, and BMP.' }
$manifest = [ordered]@{ version = 1; maps = $maps }
$manifestDirectory = Split-Path -Parent $ManifestPath
New-Item -ItemType Directory -Force -Path $manifestDirectory | Out-Null
$json = $manifest | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText([IO.Path]::GetFullPath($ManifestPath), $json + "`n", [Text.UTF8Encoding]::new($false))
Write-Output "Wrote $($maps.Count) map overview(s) to $ManifestPath"
