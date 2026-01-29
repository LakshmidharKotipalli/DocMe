def is_browser_windows(app_name):
    browsers = ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "safari.exe"]
    return any(b in app_name.lower() for b in browsers)

def get_browser_url_windows(app_name):
    """
    On Windows, extracting URLs without extensions or heavy UI automation is complex.
    For now, we return None and rely on the window title, which usually contains 
    the site name. Full URL extraction on Windows requires the 'pywinauto' library.
    """
    # Placeholder for future pywinauto implementation
    return None
