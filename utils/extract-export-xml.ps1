param(
    [string]$ExportsPath = (Join-Path $PSScriptRoot 'exports')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$exports = Get-Item -LiteralPath $ExportsPath
$outputPath = Join-Path $exports.FullName 'xml'
$archives = @(Get-ChildItem -LiteralPath $exports.FullName -Filter '*.zip' -File | Sort-Object Name)
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null

$extracted = 0
foreach ($archive in $archives) {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archive.FullName)
    try {
        $xmlEntries = @($zip.Entries | Where-Object {
            $_.Name -and [System.IO.Path]::GetExtension($_.Name) -ieq '.xml'
        })
        if ($xmlEntries.Count -ne 1) {
            throw "Expected exactly one XML file in '$($archive.Name)', found $($xmlEntries.Count)."
        }

        # Name by archive to prevent collisions between exports. Reruns replace outputs.
        $destination = Join-Path $outputPath ($archive.BaseName + '.xml')
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($xmlEntries[0], $destination, $true)
        $extracted++
    }
    finally {
        $zip.Dispose()
    }
}

Write-Output "Extracted $extracted XML files to $outputPath"
