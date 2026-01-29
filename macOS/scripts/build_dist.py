import subprocess
import os
import sys
import shutil

def build_app(platform):
    print(f"--- Building DocMe for {platform} ---")
    
    # 1. Determine directories
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", platform))
    frontend_dir = os.path.join(base_dir, "frontend")
    
    if not os.path.exists(base_dir):
        print(f"Error: {platform} directory not found at {base_dir}")
        return

    # 2. Install dependencies (if needed)
    print(f"Installing frontend dependencies in {frontend_dir}...")
    subprocess.run(["npm", "install"], cwd=frontend_dir, check=True)

    # 3. Build the frontend and pack the app
    print("Building and packaging the application...")
    # This runs 'npm run build' (Vite) and then 'electron-builder'
    subprocess.run(["npm", "run", "electron:build"], cwd=frontend_dir, check=True)

    # 4. Success
    output_dir = os.path.join(frontend_dir, "release")
    print(f"\nSuccess! Downloadable files for {platform} are located in:")
    print(output_dir)
    
    # List the generated files
    if os.path.exists(output_dir):
        files = os.listdir(output_dir)
        for f in files:
            if f.endswith(('.dmg', '.zip', '.exe', '.msi')):
                print(f" - {f}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/build_dist.py <macOS|Windows>")
        sys.exit(1)
    
    platform = sys.argv[1]
    if platform not in ["macOS", "Windows"]:
        print("Error: Platform must be 'macOS' or 'Windows'")
        sys.exit(1)
        
    try:
        build_app(platform)
    except subprocess.CalledProcessError as e:
        print(f"\nBuild failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nAn error occurred: {e}")
        sys.exit(1)
