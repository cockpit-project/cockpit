shelldir = $(pkgdatadir)/shell
shell_GZ = \
	pkg/shell/shell.min.js.gz \
	pkg/shell/bundle.min.js.gz \
	pkg/shell/shell.min.css.gz \
	pkg/shell/shell.min.html.gz \
	$(NULL)
shell_DATA = \
	pkg/shell/index.min.html \
	pkg/shell/manifest.json \
	$(shell_GZ) \
	$(NULL)

shell_SCRIPTS = \
	pkg/shell/ssh-add-public-key.sh \
	pkg/shell/ssh-list-public-keys.sh \
	$(NULL)

shelldebugdir = $(debugdir)$(shelldir)
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
	pkg/shell/cockpit-accounts.js \
	pkg/shell/authorized-keys.js \
	$(shell_SCRIPTS) \
	$(NULL)

# shell_BUNDLEFILES are included in files to be cleaned
shell_BUNDLEFILES = \
	pkg/shell/index.min.js \
	pkg/shell/machines.min.js \
	$(NULL)

shell_BUNDLE = \
	$(shell_BUNDLEFILES) \
	$(shell_SCRIPTS) \
	$(NULL)

pkg/shell/bundle.min.js: $(shell_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

shell_MINFILES = \
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
	pkg/shell/cockpit-accounts.min.js \
	pkg/shell/authorized-keys.min.js \
	$(NULL)

shell_SHELL = \
	pkg/shell/shell.js \
	$(shell_MINFILES) \
	$(NULL)

pkg/shell/shell.min.js: $(shell_SHELL)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

shellimagesdir = $(pkgdatadir)/shell/images
shellimages_DATA = \
	pkg/shell/images/server-large.png \
	pkg/shell/images/server-small.png \
	pkg/shell/images/server-error.png \
	pkg/shell/images/dialog-error.png \
	$(NULL)

pmlogconfdir = $(localstatedir)/lib/pcp/config/pmlogconf/tools
pmlogconf_DATA = pkg/shell/pmlogconf/cockpit

# -----------------------------------------------------------------------------

shell_TESTS = \
	pkg/shell/test-dummy.html \
	pkg/shell/test-util.html \
	pkg/shell/test-dbusx.html \
	pkg/shell/test-controls.html \
	pkg/shell/test-list-public-keys.sh \
	$(NULL)

TESTS += $(shell_TESTS)

# ----------------------------------------------------------------------------------------------------

CLEANFILES += \
	pkg/shell/shell.min.js \
	pkg/shell/bundle.min.js \
	pkg/shell/index.min.html \
	pkg/shell/shell.min.html \
	$(shell_BUNDLEFILES) \
	$(shell_GZ) \
	$(shell_MINFILES) \
	$(NULL)

EXTRA_DIST += \
	pkg/shell/mock \
	pkg/shell/shell.min.js \
	pkg/shell/bundle.min.js \
	pkg/shell/index.min.html \
	pkg/shell/shell.min.html \
	$(shell_DATA) \
	$(shell_BUNDLE) \
	$(shell_SHELL) \
	$(shelldebug_DATA) \
	$(shellimages_DATA) \
	$(shell_TESTS) \
	pkg/shell/pmlogconf/cockpit \
	$(NULL)
