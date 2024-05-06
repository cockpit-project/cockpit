from testlib import Browser, BrowserLayout

# used in cockpit-machines, cockpit-podman, cockpit-certificates
Browser.get_checked

# kept as being potentially useful in the future
Browser.wait_attr_not_contains

# https://github.com/jendrikseipp/vulture/issues/249
BrowserLayout.theme  # type: ignore[attr-defined]
BrowserLayout.content_size  # type: ignore[attr-defined]
