import pygetwindow as gw
import win32process
import psutil

def get_foreground_window_windows():
    try:
        window = gw.getActiveWindow()
        if not window:
            return None, None
        
        # Get process ID
        _, pid = win32process.GetWindowThreadProcessId(window._hWnd)
        process = psutil.Process(pid)
        app_name = process.name()
        
        return app_name, window.title
    except Exception:
        return None, None
