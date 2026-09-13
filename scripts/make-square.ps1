Add-Type -AssemblyName System.Drawing
$imgPath = Join-Path $PSScriptRoot "..\asset\icon.png"
$squarePath = Join-Path $PSScriptRoot "..\asset\icon-square.png"

$img = [System.Drawing.Image]::FromFile($imgPath)
$bmp = New-Object System.Drawing.Bitmap 256, 256, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

$scale = [Math]::Min(256.0 / $img.Width, 256.0 / $img.Height)
$w = [int]($img.Width * $scale)
$h = [int]($img.Height * $scale)
$x = [int]((256 - $w) / 2)
$y = [int]((256 - $h) / 2)

$g.DrawImage($img, $x, $y, $w, $h)
$g.Dispose()
$img.Dispose()

$bmp.Save($squarePath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "Created $squarePath"
