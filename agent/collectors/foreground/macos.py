try:
    from AppKit import NSWorkspace
    from Quartz import (
        CGWindowListCopyWindowInfo,
        kCGWindowListOptionOnScreenOnly,
        kCGNullWindowID,
        CGRequestScreenCaptureAccess
    )
except ImportError:
    NSWorkspace = None

def get_foreground_window_macos():
    """
    Enhanced foreground window detection using Quartz window list layers.
    """
    if NSWorkspace is None:
        return None, None, None

    # Get the official frontmost app
    active_app = NSWorkspace.sharedWorkspace().frontmostApplication()
    app_name = active_app.localizedName() if active_app else "Unknown"
    app_pid = active_app.processIdentifier() if active_app else 0

    options = kCGWindowListOptionOnScreenOnly
    window_list = CGWindowListCopyWindowInfo(options, kCGNullWindowID)

    window_title = "Unknown"
    
    if window_list:
        # Sort by layer ascending (0 is top)
        # We want the first window that has a title and belongs to an application
        for window in sorted(window_list, key=lambda x: x.get('kCGWindowLayer', 0)):
            # If we already have the active_app PID, look for its title first
            if app_pid != 0 and window.get('kCGWindowOwnerPID') == app_pid:
                title = window.get('kCGWindowName')
                if title:
                    window_title = title
                    break
        
        # If still unknown, maybe the "active_app" is just a helper/agent
        # Let's find the absolute top titled window (Layer 0) even if it's not the "active_app"
        if window_title == "Unknown":
            for window in sorted(window_list, key=lambda x: x.get('kCGWindowLayer', 0)):
                title = window.get('kCGWindowName')
                pid = window.get('kCGWindowOwnerPID')
                owner = window.get('kCGWindowOwnerName')
                if title and window.get('kCGWindowLayer') == 0:
                    window_title = title
                    app_name = owner
                    app_pid = pid
                    break

    if window_title == "Unknown":
        if not CGRequestScreenCaptureAccess():
            window_title = "[No Title Access - Check Permissions]"
        else:
            window_title = "[No Active Window Title]"

    return app_name, window_title, app_pid

if __name__ == "__main__":
    print(get_foreground_window_macos())
