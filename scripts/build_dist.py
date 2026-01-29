import subprocess
import os
import sys
import shutil

def build_app():
    print("--- Building DocMe DMG ---")
    
    # 1. Determine directories
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    frontend_dir = os.path.join(root_dir, "frontend")
    
    if not os.path.exists(frontend_dir):
        print(f"Error: Frontend directory not found at {frontend_dir}")
        return

    # 2. Install dependencies
    print(f"Installing frontend dependencies in {frontend_dir}...")
    subprocess.run(["npm", "install"], cwd=frontend_dir, check=True)

    # 3. Build and package
    print("Building and packaging the application (macOS DMG)...")
    subprocess.run(["npm", "run", "electron:build"], cwd=frontend_dir, check=True)

    # 4. Success check
    output_dir = os.path.join(frontend_dir, "release")
    print(f"\nBuild process finished. Check {output_dir} for output.")
    
    if os.path.exists(output_dir):
        files = os.listdir(output_dir)
        dmgs = [f for f in files if f.endswith('.dmg')]
        if dmgs:
            print("\nGenerated DMG files:")
            for dmg in dmgs:
                print(f" - {dmg}")
        else:
            print("\nNo DMG files found. Please check build logs.")

if __name__ == "__main__":
    try:
        build_app()
    except subprocess.CalledProcessError as e:
        print(f"\nBuild failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nAn error occurred: {e}")
        sys.exit(1)
