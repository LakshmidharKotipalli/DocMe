import sys
from .foreground.macos import get_foreground_window_macos
from .idle.macos import get_idle_time_macos

def get_foreground_window():
    return get_foreground_window_macos()

def get_idle_time():
    return get_idle_time_macos()
