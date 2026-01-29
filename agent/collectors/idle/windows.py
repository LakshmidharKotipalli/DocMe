import win32api

def get_idle_time_windows():
    """Returns the idle time in seconds on Windows."""
    try:
        millis = win32api.GetTickCount() - win32api.GetLastInputInfo()
        return millis / 1000.0
    except Exception:
        return 0
