serversystemddir = $(pkgdatadir)/server-systemd
serversystemd_DATA = \
	pkg/server-systemd/log.html \
	pkg/server-systemd/log.min.html \
	pkg/server-systemd/manifest.json \
	pkg/server-systemd/server.js \
	pkg/server-systemd/server.min.js \
	pkg/server-systemd/terminal.html \
	pkg/server-systemd/terminal.min.html \
	$(NULL)

serversystemd_TESTS = \
	pkg/server-systemd/test-journal-renderer.html \
	$(NULL)

TESTS += $(serversystemd_TESTS)

CLEANFILES += \
	pkg/server-systemd/log.min.html \
	pkg/server-systemd/server.min.js \
	pkg/server-systemd/terminal.min.html \
	$(NULL)

EXTRA_DIST += \
	$(serversystemd_DATA) \
	$(serversystemd_TESTS) \
	$(NULL)
