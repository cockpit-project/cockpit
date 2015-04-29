shelldir = $(pkgdatadir)/shell
shell_DATA = \
	pkg/shell/shell.min.js.gz \
	pkg/shell/bundle.min.js.gz \
	pkg/shell/index.min.html \
	pkg/shell/shell.min.css.gz \
	pkg/shell/shell.min.html.gz \
	pkg/shell/manifest.json \
	$(NULL)

shelldebugdir = $(DBGDIR)$(shelldir)
shelldebug_DATA = \
	pkg/shell/shell.js \
	pkg/shell/bundle.js \
	pkg/shell/index.html \
	pkg/shell/index.js \
	pkg/shell/machines.js \
	pkg/shell/shell.css \
	pkg/shell/shell.html \
	pkg/shell/dbus.js \
	pkg/shell/controls.js \
	pkg/shell/plot.js \
	pkg/shell/canvas.js \
	pkg/shell/cockpit-util.js \
	pkg/shell/cockpit-main.js \
	pkg/shell/cockpit-plot.js \
	pkg/shell/cockpit-dashboard.js \
	pkg/shell/cockpit-setup.js \
	pkg/shell/cockpit-server.js \
	pkg/shell/cockpit-cpu-status.js \
	pkg/shell/cockpit-memory-status.js \
	pkg/shell/cockpit-networking.js \
	pkg/shell/cockpit-storage.js \
	pkg/shell/cockpit-accounts.js \
	pkg/shell/cockpit-docker.js \
	$(NULL)

shell_BUNDLE = \
	pkg/shell/index.min.js \
	pkg/shell/machines.min.js \
	$(NULL)

pkg/shell/bundle.min.js: $(shell_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

shell_SHELL = \
	pkg/shell/shell.js \
	pkg/shell/dbus.min.js \
	pkg/shell/controls.min.js \
	pkg/shell/plot.min.js \
	pkg/shell/canvas.min.js \
	pkg/shell/cockpit-util.min.js \
	pkg/shell/cockpit-main.min.js \
	pkg/shell/cockpit-plot.min.js \
	pkg/shell/cockpit-dashboard.min.js \
	pkg/shell/cockpit-setup.min.js \
	pkg/shell/cockpit-server.min.js \
	pkg/shell/cockpit-cpu-status.min.js \
	pkg/shell/cockpit-memory-status.min.js \
	pkg/shell/cockpit-networking.min.js \
	pkg/shell/cockpit-storage.min.js \
	pkg/shell/cockpit-accounts.min.js \
	pkg/shell/cockpit-docker.min.js \
	$(NULL)

pkg/shell/shell.min.js: $(shell_SHELL)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

shellimagesdir = $(pkgdatadir)/shell/images
shellimages_DATA = \
	pkg/shell/images/server-large.png \
	pkg/shell/images/server-small.png \
	pkg/shell/images/server-error.png \
	pkg/shell/images/dialog-error.png \
	pkg/shell/images/storage-disk.png \
	$(NULL)

pmlogconfdir = $(localstatedir)/lib/pcp/config/pmlogconf/tools
pmlogconf_DATA = pkg/shell/pmlogconf/cockpit

# -----------------------------------------------------------------------------

CHECK_HTML = \
	pkg/shell/test-dummy.html \
	pkg/shell/test-util.html \
	pkg/shell/test-dbusx.html \
	pkg/shell/test-controls.html \
	$(NULL)

TESTS += $(CHECK_HTML)

# ----------------------------------------------------------------------------------------------------

CLEANFILES += \
	pkg/shell/shell.min.js \
	pkg/shell/bundle.min.js \
	pkg/shell/index.min.html \
	pkg/shell/shell.min.html \
	$(shell_BUNDLE) \
	$(NULL)

EXTRA_DIST += \
	pkg/shell/shell.min.js \
	pkg/shell/bundle.min.js \
	pkg/shell/index.min.html \
	pkg/shell/shell.min.html \
	$(shell_DATA) \
	$(shell_BUNDLE) \
	$(shell_SHELL) \
	$(shelldebug_DATA) \
	$(shellimages_DATA) \
	$(CHECK_HTML) \
	pkg/shell/pmlogconf/cockpit \
	$(NULL)
