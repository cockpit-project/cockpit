shell_js_PARTS = \
	pkg/shell/polyfills.js \
	pkg/shell/dbus.js \
	pkg/shell/debug.js \
	pkg/shell/controls.js \
	pkg/shell/plot.js \
	pkg/shell/canvas.js \
	pkg/shell/cockpit-util.js \
	pkg/shell/cockpit-main.js \
	pkg/shell/cockpit-plot.js \
	pkg/shell/cockpit-about.js \
	pkg/shell/cockpit-language.js \
	pkg/shell/cockpit-dashboard.js \
	pkg/shell/cockpit-setup.js \
	pkg/shell/cockpit-server.js \
	pkg/shell/cockpit-cpu-status.js \
	pkg/shell/cockpit-memory-status.js \
	pkg/shell/cockpit-networking.js \
	pkg/shell/cockpit-storage.js \
	pkg/shell/cockpit-realms.js \
	pkg/shell/cockpit-services.js \
	pkg/shell/cockpit-accounts.js \
	pkg/shell/cockpit-docker.js \
	$(NULL)

shell.js: $(shell_js_PARTS)
	$(V_CHECK) $(srcdir)/tools/missing $(srcdir)/tools/jshint $^
	$(AM_V_GEN) cat $^ > $@.tmp && mv $@.tmp $@

shell.min.js: shell.js
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/uglifyjs $< --mangle > $@.tmp && mv $@.tmp $@

shelldir = $(pkgdatadir)/shell
shell_DATA = \
	shell.js \
	shell.min.js \
	pkg/shell/shell.css \
	pkg/shell/shell.html \
	pkg/shell/shell.min.html \
	pkg/shell/manifest.json \
	$(NULL)
noinst_DATA += \
	$(NULL)

shelllangdir = $(pkgdatadir)/shell/lang
shelllang_DATA = \
	$(translations_json) \
	$(NULL)

shellimagesdir = $(pkgdatadir)/shell/images
shellimages_DATA = \
	pkg/shell/images/bg-login.jpg \
	pkg/shell/images/category-containers.png \
	pkg/shell/images/category-journal.png \
	pkg/shell/images/category-networking.png \
	pkg/shell/images/category-services.png \
	pkg/shell/images/category-shutdown.png \
	pkg/shell/images/category-storage.png \
	pkg/shell/images/category-system.png \
	pkg/shell/images/category-users.png \
	pkg/shell/images/avatar-default-48.png \
	pkg/shell/images/avatar-default-128.png \
	pkg/shell/images/server-large.png \
	pkg/shell/images/server-small.png \
	pkg/shell/images/server-error.png \
	pkg/shell/images/dialog-error.png \
	pkg/shell/images/face-smile.png \
	pkg/shell/images/storage-disk.png \
	pkg/shell/images/switcher.png \
	$(NULL)

# -----------------------------------------------------------------------------

CHECK_HTML = \
	pkg/shell/test-dummy.html \
	pkg/shell/test-util.html \
	pkg/shell/test-dbusx.html \
	pkg/shell/test-controls.html \
	$(NULL)

TESTS += $(CHECK_HTML)

# ----------------------------------------------------------------------------------------------------

lang/%.json : $(top_srcdir)/po/%.po
	$(AM_V_GEN) mkdir -p lang && $(PO2JSON) -p $(top_srcdir)/po/$*.po > lang/$*.json

CLEANFILES += \
	shell.js \
	shell.min.js \
	pkg/shell/shell.min.html \
	$(NULL)

EXTRA_DIST += \
	$(shell_js_PARTS) \
	$(shell_DATA) \
	$(shellimages_DATA) \
	$(CHECK_HTML) \
	pkg/shell/shell.html \
	$(NULL)
