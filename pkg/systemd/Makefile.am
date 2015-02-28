systemddir = $(pkgdatadir)/system
systemd_DATA = \
	pkg/systemd/log.html \
	pkg/systemd/log.min.html \
	pkg/systemd/manifest.json \
	pkg/systemd/server.js \
	pkg/systemd/server.min.js \
	pkg/systemd/terminal.html \
	pkg/systemd/terminal.min.html \
	$(NULL)

systemd_TESTS = \
	pkg/systemd/test-journal-renderer.html \
	$(NULL)

TESTS += $(systemd_TESTS)

CLEANFILES += \
	pkg/systemd/log.min.html \
	pkg/systemd/server.min.js \
	pkg/systemd/terminal.min.html \
	$(NULL)

EXTRA_DIST += \
	$(systemd_DATA) \
	$(systemd_TESTS) \
	$(NULL)
