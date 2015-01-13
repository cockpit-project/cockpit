LINGUAS = de da

po/po.en.js: pkg/base/po.js
	$(AM_V_GEN) cp $^ $@

basedir = $(pkgdatadir)/base
base_GEN = \
	$(addprefix po/po.,$(addsuffix .js,$(LINGUAS))) \
	$(NULL)
base_DATA = \
	pkg/base/patternfly.css \
	pkg/base/cockpit.css \
	pkg/base/cockpit.js \
	pkg/base/cockpit.min.js \
	pkg/base/jquery.js \
	pkg/base/jquery.min.js \
	pkg/base/mustache.js \
	pkg/base/mustache.min.js \
	pkg/base/term.js \
	pkg/base/manifest.json \
	po/po.en.js \
	$(base_GEN) \
	$(NULL)

baseimagesdir = $(pkgdatadir)/base/images
baseimages_DATA = \
	pkg/base/images/play.png \
	pkg/base/images/eject.png \
	pkg/base/images/stop.png \
	$(NULL)

base_TESTS = \
	pkg/base/test-base64.html \
	pkg/base/test-utf8.html \
	pkg/base/test-chan.html \
	pkg/base/test-echo.html \
	pkg/base/test-async.html \
	pkg/base/test-no-jquery.html \
        pkg/base/test-amdjs.html \
	pkg/base/test-spawn.html \
	pkg/base/test-spawn-proc.html \
	pkg/base/test-http.html \
	pkg/base/test-dbus.html \
	pkg/base/test-location.html \
	pkg/base/test-framed.html \
	pkg/base/test-locale.html \
	pkg/base/test-format.html \
	pkg/base/test-file.html \
	pkg/base/test-user.html \
	$(NULL)

TESTS += $(base_TESTS)

CLEANFILES += \
	pkg/base/cockpit.min.js \
	po/po.en.js \
	$(base_GEN) \
	$(NULL)

EXTRA_DIST += \
	pkg/base/po.js \
	$(base_DATA) \
	$(base_TESTS) \
	$(baseimages_DATA) \
	$(NULL)

update-jquery:
	$(srcdir)/tools/jsmerge -o $(srcdir)/pkg/base/jquery.js \
	    $(srcdir)/lib/jquery.v2.1.0.js \
	    $(srcdir)/lib/bootstrap.v3.0.3.js \
	    $(srcdir)/lib/bootstrap-select.v1.6.3.js \
	    $(srcdir)/lib/jquery-flot.v0.7.js
	$(srcdir)/tools/jsmerge -o $(srcdir)/pkg/base/jquery.min.js \
	    $(srcdir)/lib/jquery.v2.1.0.min.js \
	    $(srcdir)/lib/bootstrap.v3.0.3.min.js \
	    $(srcdir)/lib/bootstrap-select.v1.6.3.min.js \
	    $(srcdir)/lib/jquery-flot.v0.7.min.js

# Never recreate these files
pkg/base/jquery.min.js:
	@true
pkg/base/mustache.min.js:
	@true
