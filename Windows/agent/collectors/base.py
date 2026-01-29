import sys
from .foreground.windows import get_foreground_window_windows
from .idle.windows import get_idle_time_windows

def get_foreground_window():
    return get_foreground_window_windows()

def get_idle_time():
    return get_idle_time_windows()
