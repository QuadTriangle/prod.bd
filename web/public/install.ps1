# prod.bd installer script for Windows
# Downloads the latest release from GitHub

$ErrorActionPreference = "Stop"

$REPO = "quadtriangle/prod.bd"
$BINARY_NAME = "prod"
$INSTALL_DIR = "$env:LOCALAPPDATA\prod"

# Detect architecture
$ARCH = if ([Environment]::Is64BitOperatingSystem) {
    if ([Environment]::GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") -eq "ARM64") {
        "arm64"
    } else {
        "amd64"
    }
} else {
    Write-Host "Error: 32-bit Windows is not supported"
    exit 1
}

Write-Host "Detected platform: windows-$ARCH"

# Get latest release
$RELEASE_URL = "https://api.github.com/repos/$REPO/releases/latest"
Write-Host "Fetching latest release..."

try {
    $release = Invoke-RestMethod -Uri $RELEASE_URL
    $asset = $release.assets | Where-Object { $_.name -eq "$BINARY_NAME-windows-$ARCH.exe" }

    if (-not $asset) {
        Write-Host "Error: Could not find release for windows-$ARCH"
        exit 1
    }

    $DOWNLOAD_URL = $asset.browser_download_url
    Write-Host "Downloading from: $DOWNLOAD_URL"

    # Create install directory
    if (-not (Test-Path $INSTALL_DIR)) {
        New-Item -ItemType Directory -Path $INSTALL_DIR | Out-Null
    }

    $BINARY_PATH = Join-Path $INSTALL_DIR "$BINARY_NAME.exe"

    # Download binary
    Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $BINARY_PATH

    # Add to PATH if not already there
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$INSTALL_DIR*") {
        Write-Host "Adding $INSTALL_DIR to PATH..."
        [Environment]::SetEnvironmentVariable(
            "Path",
            "$userPath;$INSTALL_DIR",
            "User"
        )
        $env:Path = "$env:Path;$INSTALL_DIR"
    }

    Write-Host "✓ $BINARY_NAME installed successfully to $BINARY_PATH"
    Write-Host ""
    Write-Host "Run '$BINARY_NAME 3000' to get started!"
    Write-Host "Note: You may need to restart your terminal for PATH changes to take effect."

} catch {
    Write-Host "Error: $_"
    exit 1
}
