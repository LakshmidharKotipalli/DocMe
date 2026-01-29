import sys

def get_foreground_window():
    if sys.platform == "darwin":
        from .foreground.macos import get_foreground_window_macos
        return get_foreground_window_macos()
    elif sys.platform == "win32":
        from .foreground.windows import get_foreground_window_windows
        return get_foreground_window_windows()
    else:
        return "Linux App", "Linux Window", 0

def get_idle_time():
    if sys.platform == "darwin":
        from .idle.macos import get_idle_time_macos
        return get_idle_time_macos()
    elif sys.platform == "win32":
        from .idle.windows import get_idle_time_windows
        return get_idle_time_windows()
    else:
        return 0
