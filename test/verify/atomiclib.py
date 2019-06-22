def overlay_dashboard(m):
    # If we can do package overlays on Atomic host, then try that here
    # This tests the case that cockpit-dashboard is installable via
    # package overlays on Atomic Host
    # The libssh RPM was placed by the atomic setup scripts

    if m.image in ["fedora-atomic"]:
        m.execute("rpm-ostree install /var/tmp/build-results/cockpit-dashboard-*.rpm")
        m.spawn("sleep 2 && systemctl reboot", "reboot")
        m.wait_reboot()
