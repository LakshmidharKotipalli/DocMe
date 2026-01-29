import subprocess
from loguru import logger

def get_browser_url_macos(browser_name):
    """
    Uses AppleScript to get the current tab URL from common browsers.
    Supports: Google Chrome, Safari, Arc, Microsoft Edge.
    """
    script = ""
    if any(b in browser_name for b in ["Chrome", "Edge", "Brave", "Vivaldi", "Opera", "Arc"]):
        script = f'tell application "{browser_name}" to get URL of active tab of front window'
    elif "Safari" in browser_name:
        script = 'tell application "Safari" to get URL of document 1'
    elif "Orion" in browser_name:
        script = 'tell application "Orion" to get URL of document 1'
    
    if not script:
        return None

    try:
        result = subprocess.run(['osascript', '-e', script], capture_output=True, text=True, timeout=2)
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception as e:
        logger.debug(f"Failed to get URL for {browser_name}: {e}")
    
    return None

def is_browser(app_name):
    browsers = ["Google Chrome", "Safari", "Arc", "Microsoft Edge", "Firefox", "Brave Browser", "Vivaldi", "Opera", "Orion"]
    return any(b in app_name for b in browsers)
