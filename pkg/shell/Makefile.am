shelldir = $(pkgdatadir)/shell
nodist_shell_DATA = \
	pkg/shell/shell.min.js.gz \
	pkg/shell/bundle.min.js.gz \
	pkg/shell/plot.min.css.gz \
	pkg/shell/shell.min.css.gz \
	pkg/shell/shell.min.html.gz \
	$(NULL)

shell_TEMPLATES = \
	pkg/shell/templates/add-machine.html \
	pkg/shell/templates/auth-failed.html \
	pkg/shell/templates/change-auth.html \
	pkg/shell/templates/change-port.html \
	pkg/shell/templates/color-picker.html \
	pkg/shell/templates/invalid-hostkey.html \
	pkg/shell/templates/not-supported.html \
	pkg/shell/templates/sync-users.html \
	pkg/shell/templates/unknown-hostkey.html \
	$(NULL)

shell_DATA = \
	pkg/shell/index.min.html \
	pkg/shell/simple.min.html \
	pkg/shell/manifest.json \
	$(NULL)

shell_SCRIPTS = \
	pkg/shell/ssh-list-private-keys.sh \
	$(NULL)

shelltemplatesdebugdir = $(debugdir)$(shelldir)/templates
shelltemplatesdebug_DATA = \
	$(shell_TEMPLATES) \
	$(NULL)

shelldebugdir = $(debugdir)$(shelldir)
shelldebug_DATA = \
	pkg/shell/shell.js \
	pkg/shell/attrchange.js \
	pkg/shell/base_index.js \
	pkg/shell/bundle.js \
	pkg/shell/credentials.js \
	pkg/shell/index.html \
	pkg/shell/index.js \
	pkg/shell/machines.js \
	pkg/shell/plot.css \
	pkg/shell/machine-dialogs.js \
	pkg/shell/shell.css \
	pkg/shell/shell.html \
	pkg/shell/simple-index.js \
	pkg/shell/simple.html \
	pkg/shell/controls.js \
	pkg/shell/plot.js \
	pkg/shell/cockpit-util.js \
	pkg/shell/cockpit-plot.js \
	$(shell_SCRIPTS) \
	$(NULL)

shell_MINIFIED = \
	pkg/shell/base_index.min.js \
	pkg/shell/credentials.min.js \
	pkg/shell/index.min.js \
	pkg/shell/simple-index.min.js \
	pkg/shell/machines.min.js \
	pkg/shell/machine-dialogs.min.js \
	$(NULL)

shell_BUNDLE = \
	$(shell_MINIFIED) \
	$(shell_SCRIPTS) \
	$(shell_TEMPLATES) \
	$(NULL)

pkg/shell/bundle.min.js: $(shell_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

shell_MINFILES = \
	pkg/shell/attrchange.min.js \
	pkg/shell/controls.min.js \
	pkg/shell/plot.min.js \
	pkg/shell/cockpit-util.min.js \
	pkg/shell/cockpit-plot.min.js \
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
	$(NULL)

# -----------------------------------------------------------------------------

shell_TESTS = \
	pkg/shell/test-dummy.html \
	pkg/shell/test-controls.html \
	$(NULL)

TESTS += $(shell_TESTS)

# ----------------------------------------------------------------------------------------------------

CLEANFILES += \
	pkg/shell/plot.min.css \
	pkg/shell/shell.min.css \
	pkg/shell/shell.min.js \
	pkg/shell/bundle.min.js \
	pkg/shell/index.min.html \
	pkg/shell/shell.min.html \
	pkg/shell/simple.min.html \
	$(shell_MINIFIED) \
	$(nodist_shell_DATA) \
	$(shell_MINFILES) \
	$(NULL)

EXTRA_DIST += \
	pkg/shell/plot.min.css \
	pkg/shell/shell.min.css \
	pkg/shell/shell.min.js \
	pkg/shell/bundle.min.js \
	pkg/shell/index.min.html \
	pkg/shell/shell.min.html \
	pkg/shell/simple.min.html \
	$(shell_MINFILES) \
	$(shell_BUNDLE) \
	$(NULL)
