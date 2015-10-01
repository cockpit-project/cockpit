shelldir = $(pkgdatadir)/shell
nodist_shell_DATA = \
	assets/shell/shell.min.js.gz \
	assets/shell/bundle.min.js.gz \
	assets/shell/shell.min.css.gz \
	assets/shell/shell.min.html.gz \
	$(NULL)
shell_DATA = \
	assets/shell/index.min.html \
	assets/shell/manifest.json \
	$(NULL)

shelldebugdir = $(debugdir)$(shelldir)
shelldebug_DATA = \
	assets/shell/shell.js \
	assets/shell/bundle.js \
	assets/shell/index.html \
	assets/shell/index.js \
	assets/shell/machines.js \
	assets/shell/shell.css \
	assets/shell/shell.html \
	assets/shell/dbus.js \
	assets/shell/controls.js \
	assets/shell/plot.js \
	assets/shell/cockpit-util.js \
	assets/shell/cockpit-plot.js \
	$(NULL)

shell_MINIFIED = \
	assets/shell/index.min.js \
	assets/shell/machines.min.js \
	$(NULL)

shell_BUNDLE = \
	$(shell_MINIFIED) \
	$(NULL)

assets/shell/bundle.min.js: $(shell_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

shell_MINFILES = \
	assets/shell/dbus.min.js \
	assets/shell/controls.min.js \
	assets/shell/plot.min.js \
	assets/shell/cockpit-util.min.js \
	assets/shell/cockpit-plot.min.js \
	$(NULL)

shell_SHELL = \
	assets/shell/shell.js \
	$(shell_MINFILES) \
	$(NULL)

assets/shell/shell.min.js: $(shell_SHELL)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

shellimagesdir = $(pkgdatadir)/shell/images
shellimages_DATA = \
	assets/shell/images/server-large.png \
	assets/shell/images/server-small.png \
	assets/shell/images/server-error.png \
	$(NULL)

# -----------------------------------------------------------------------------

shell_TESTS = \
	assets/shell/test-dummy.html \
	assets/shell/test-controls.html \
	$(NULL)

TESTS += $(shell_TESTS)

# ----------------------------------------------------------------------------------------------------

CLEANFILES += \
	assets/shell/shell.min.css \
	assets/shell/shell.min.js \
	assets/shell/bundle.min.js \
	assets/shell/index.min.html \
	assets/shell/shell.min.html \
	$(shell_MINIFIED) \
	$(nodist_shell_DATA) \
	$(shell_MINFILES) \
	$(NULL)

EXTRA_DIST += \
	assets/shell/shell.min.css \
	assets/shell/shell.min.js \
	assets/shell/bundle.min.js \
	assets/shell/index.min.html \
	assets/shell/shell.min.html \
	$(shell_DATA) \
	$(shell_BUNDLE) \
	$(shell_SHELL) \
	$(shelldebug_DATA) \
	$(shellimages_DATA) \
	$(shell_TESTS) \
	$(NULL)
