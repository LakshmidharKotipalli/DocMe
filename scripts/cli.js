#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const command = args[0] || 'open';

const ROOT_DIR = path.resolve(__dirname, '..');

const commands = {
    'open': () => {
        console.log('🚀 Opening DocMe...');
        execSync('open /Applications/DocMe.app');
    },
    'install': () => {
        console.log('🏗️ Starting installation...');
        try {
            execSync(`bash ${path.join(ROOT_DIR, 'scripts', 'install_macos.sh')}`, { stdio: 'inherit' });
        } catch (e) {
            console.error('❌ Installation failed.');
        }
    },
    'status': () => {
        const isInstalled = fs.existsSync('/Applications/DocMe.app');
        console.log(`📍 Status: ${isInstalled ? '✅ Installed' : '❌ Not installed'}`);
        if (isInstalled) {
            const version = execSync('defaults read /Applications/DocMe.app/Contents/Info.plist CFBundleShortVersionString').toString().trim();
            console.log(`📦 Version: ${version}`);
        }
    },
    'help': () => {
        console.log('\n📖 DocMe CLI Help');
        console.log('----------------');
        console.log('docme install - Build and install to /Applications');
        console.log('docme open    - Launch the app');
        console.log('docme status  - Check installation status');
        console.log('docme help    - Show this message\n');
    }
};

if (commands[command]) {
    commands[command]();
} else {
    console.log(`❓ Unknown command: ${command}`);
    commands['help']();
}
