#!/bin/bash

# DocMe Remote Installer for macOS
set -e

# Configuration
VERSION="1.1.0"
APP_NAME="DocMe"
DOWNLOAD_URL="https://github.com/LakshmidharKotipalli/DocMe/releases/download/v${VERSION}/DocMe-${VERSION}-arm64-mac.zip"
ZIP_FILE="/tmp/DocMe.zip"
INSTALL_DIR="/Applications"

echo "------------------------------------------"
echo "🔍 Installing DocMe v${VERSION}..."
echo "------------------------------------------"

# 1. Download
echo "📥 Downloading application package..."
curl -L "$DOWNLOAD_URL" -o "$ZIP_FILE"

# 2. Extract
echo "📦 Extracting package..."
mkdir -p "/tmp/DocMe_Extract"
unzip -q "$ZIP_FILE" -d "/tmp/DocMe_Extract"

# 3. Install
echo "🚚 Moving to Applications..."
if [ -d "${INSTALL_DIR}/${APP_NAME}.app" ]; then
    echo "♻️  Updating existing version..."
    rm -rf "${INSTALL_DIR}/${APP_NAME}.app"
fi

# The ZIP usually contains the .app directly
cp -R "/tmp/DocMe_Extract/${APP_NAME}.app" "$INSTALL_DIR/"

# 4. Cleanup
echo "🧹 Cleaning up..."
rm -rf "$ZIP_FILE" "/tmp/DocMe_Extract"

# 5. Launch
echo "------------------------------------------"
echo "✅ DocMe is now installed in your Applications folder!"
echo "🚀 Launching..."
echo "------------------------------------------"

open "${INSTALL_DIR}/${APP_NAME}.app"
