shelldir = $(pkgdatadir)/shell
shell_PO = \
	$(addprefix po/po.,$(addsuffix .js,$(LINGUAS))) \
	$(NULL)
nodist_shell_DATA = \
	pkg/shell/bundle.min.js.gz \
	pkg/shell/po.js.gz \
	pkg/shell/shell.min.css.gz \
	pkg/shell/shell.min.html.gz \
	$(shell_PO:.js=.js.gz) \
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
	pkg/shell/stub.min.html \
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
	pkg/shell/base_index.js \
	pkg/shell/bundle.js \
	pkg/shell/credentials.js \
	pkg/shell/index.html \
	pkg/shell/index.js \
	pkg/shell/indexes.js \
	pkg/shell/index-no-machines.js \
	pkg/shell/index-stub.js \
	pkg/shell/machines.js \
	pkg/shell/mustache.js \
	pkg/shell/patterns.js \
	pkg/shell/po.js \
	pkg/shell/machine-dialogs.js \
	pkg/shell/shell.css \
	pkg/shell/shell.html \
	pkg/shell/simple.html \
	pkg/shell/stub.html \
	$(shell_SCRIPTS) \
	$(shell_PO) \
	$(NULL)

shell_MINIFIED = \
	pkg/shell/base_index.min.js \
	pkg/shell/credentials.min.js \
	pkg/shell/index.min.js \
	pkg/shell/indexes.min.js \
	pkg/shell/index-no-machines.min.js \
	pkg/shell/index-stub.min.js \
	pkg/shell/machines.min.js \
	pkg/shell/machine-dialogs.min.js \
	pkg/shell/mustache.min.js \
	pkg/shell/patterns.min.js \
	$(NULL)

shell_BUNDLE = \
	pkg/shell/bundle.js \
	$(shell_MINIFIED) \
	$(shell_SCRIPTS) \
	$(shell_TEMPLATES) \
	$(NULL)

pkg/shell/bundle.min.js: $(shell_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

# Ugliness to be solved by webpack in the future
pkg/shell/mustache.min.js: pkg/shell/mustache.js
	$(MIN_JS_RULE)

shellimagesdir = $(pkgdatadir)/shell/images
shellimages_DATA = \
	pkg/shell/images/server-large.png \
	pkg/shell/images/server-small.png \
	pkg/shell/images/server-error.png \
	$(NULL)

# -----------------------------------------------------------------------------

shell_TESTS = \
	pkg/shell/test-dummy.html \
	pkg/shell/test-machines.html \
	$(NULL)

TESTS += $(shell_TESTS)

# ----------------------------------------------------------------------------------------------------

CLEANFILES += \
	pkg/shell/shell.min.css \
	pkg/shell/bundle.min.js \
	pkg/shell/index.min.html \
	pkg/shell/shell.min.html \
	pkg/shell/simple.min.html \
	pkg/shell/stub.min.html \
	$(shell_MINIFIED) \
	$(nodist_shell_DATA) \
	$(shell_MINFILES) \
	$(shell_PO) \
	$(shell_PO:.js=.min.js) \
	$(NULL)

EXTRA_DIST += \
	pkg/shell/shell.min.css \
	pkg/shell/bundle.min.js \
	pkg/shell/index.min.html \
	pkg/shell/shell.min.html \
	pkg/shell/simple.min.html \
	pkg/shell/stub.min.html \
	$(shell_MINFILES) \
	$(shell_BUNDLE) \
	$(shell_PO) \
	$(shell_PO:.js=.min.js) \
	$(NULL)
