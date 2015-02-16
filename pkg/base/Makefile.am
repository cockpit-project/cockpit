LINGUAS = de da

po/po.en.js: pkg/base/po.js
	$(AM_V_GEN) cp $^ $@

basedir = $(pkgdatadir)/base1
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

baseimagesdir = $(pkgdatadir)/base1/images
baseimages_DATA = \
	pkg/base/images/play.png \
	pkg/base/images/eject.png \
	pkg/base/images/stop.png \
	$(NULL)

basefontsdir = $(pkgdatadir)/base1/fonts
basefonts_DATA = \
	pkg/base/fonts/fontawesome.woff \
	pkg/base/fonts/patternfly.woff \
	pkg/base/fonts/glyphicons.woff \
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
	pkg/base/test-time.html \
	pkg/base/test-permissions.html \
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
	$(basefonts_DATA) \
	$(NULL)

BASE_LN = cd $(srcdir)/pkg/base; ln -sf
FONTS_LN = cd $(srcdir)/pkg/base/fonts; ln -sf
VX = v*[0-9]

update-lib::
	$(srcdir)/tools/jsmerge -o $(srcdir)/pkg/base/jquery.js \
	    $(srcdir)/lib/jquery.$(VX).js \
	    $(srcdir)/lib/bootstrap.$(VX).js \
	    $(srcdir)/lib/bootstrap-select.$(VX).js \
	    $(srcdir)/lib/jquery-flot.$(VX).js \
	    $(srcdir)/lib/jquery-flot-selection.$(VX).js \
	    $(srcdir)/lib/jquery-flot-time.$(VX).js \
	    $(srcdir)/lib/attrchange.js
	$(srcdir)/tools/jsmerge -o $(srcdir)/pkg/base/jquery.min.js \
	    $(srcdir)/lib/jquery.$(VX).min.js \
	    $(srcdir)/lib/bootstrap.$(VX).min.js \
	    $(srcdir)/lib/bootstrap-select.$(VX).min.js \
	    $(srcdir)/lib/jquery-flot.$(VX).min.js \
	    $(srcdir)/lib/jquery-flot-selection.$(VX).min.js \
	    $(srcdir)/lib/jquery-flot-time.$(VX).min.js \
	    $(srcdir)/lib/attrchange.min.js
	$(BASE_LN) ../../lib/mustache.$(VX).js mustache.js
	$(BASE_LN) ../../lib/mustache.$(VX).min.js mustache.min.js
	$(BASE_LN) ../../lib/patternfly.$(VX).css patternfly.css
	$(BASE_LN) ../../lib/term.$(VX).js term.js
	$(FONTS_LN) ../../../lib/fontawesome.$(VX).woff fontawesome.woff
	$(FONTS_LN) ../../../lib/patternfly.$(VX).woff patternfly.woff
	$(FONTS_LN) ../../../lib/glyphicons-halflings.$(VX).woff glyphicons.woff

# Never recreate these files
pkg/base/jquery.min.js:
	@true
pkg/base/mustache.min.js:
	@true
