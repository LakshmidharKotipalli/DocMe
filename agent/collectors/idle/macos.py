try:
    from Quartz import CGEventSourceSecondsSinceLastEventType, kCGAnyInputEventType
except ImportError:
    CGEventSourceSecondsSinceLastEventType = None

def get_idle_time_macos():
    """
    Returns the number of seconds since last user input on macOS.
    """
    if CGEventSourceSecondsSinceLastEventType is None:
        return 0
    return CGEventSourceSecondsSinceLastEventType(1, kCGAnyInputEventType)

if __name__ == "__main__":
    print(get_idle_time_macos())
