#!/bin/bash

# DocMe CLI Installer for macOS
set -e

echo "------------------------------------------"
echo "🔍 Checking dependencies..."
echo "------------------------------------------"

# Ensure we are in the root directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$( dirname "$SCRIPT_DIR" )"
cd "$ROOT_DIR"

if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm is not installed. Please install Node.js first."
    exit 1
fi

if ! command -v python3 &> /dev/null; then
    echo "❌ Error: python3 is not installed."
    exit 1
fi

echo "------------------------------------------"
echo "🏗️ Building DocMe Production Bundle..."
echo "------------------------------------------"

cd frontend
npm install
npm run electron:build

echo "------------------------------------------"
echo "🚚 Installing to Applications folder..."
echo "------------------------------------------"

# Remove old version if exists
if [ -d "/Applications/DocMe.app" ]; then
    echo "♻️ Removing previous version..."
    rm -rf "/Applications/DocMe.app"
fi

# Copy the newly built app
cp -R release/mac-arm64/DocMe.app /Applications/

echo "------------------------------------------"
echo "✅ Installation Complete!"
echo "🚀 launching DocMe..."
echo "------------------------------------------"

open /Applications/DocMe.app
