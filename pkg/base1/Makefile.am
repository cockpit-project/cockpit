LINGUAS = de da pl

basedir = $(pkgdatadir)/base1
base_GEN = \
	$(addprefix po/po.,$(addsuffix .js,$(LINGUAS))) \
	$(NULL)
base_DATA = \
	pkg/base1/cockpit.min.css.gz \
	pkg/base1/manifest.json \
	pkg/base1/po.js.gz \
	pkg/base1/require.min.js.gz \
	pkg/base1/term.min.js.gz \
	pkg/base1/mustache.min.js.gz \
	pkg/base1/jquery.min.js.gz \
	pkg/base1/cockpit.min.js.gz \
	pkg/base1/bundle.min.js.gz \
	$(base_GEN:.js=.js.gz) \
	$(NULL)

basedebugdir = $(DBGDIR)$(basedir)
basedebug_DATA = \
	pkg/base1/cockpit.css \
	pkg/base1/patternfly.css \
	pkg/base1/po.js \
	pkg/base1/require.js \
	pkg/base1/term.js \
	pkg/base1/mustache.js \
	pkg/base1/jquery.js \
	pkg/base1/cockpit.js \
	$(base_GEN) \
	$(NULL)

base_BUNDLE = \
	pkg/base1/require.min.js \
	pkg/base1/cockpit.min.js \
	pkg/base1/jquery.min.js \
	pkg/base1/mustache.min.js \
	$(NULL)

pkg/base1/bundle.min.js: $(base_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^
pkg/base1/term.min.js: pkg/base1/term.js
	@$(MKDIR_P) $(dir $@)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/uglifyjs $< --mangle > $@.tmp && mv $@.tmp $@

install-data-local::
	$(MKDIR_P) $(DESTDIR)$(basedebugdir)
	$(LN_S) -f require.js $(DESTDIR)$(basedebugdir)/bundle.js

baseimagesdir = $(pkgdatadir)/base1/images
baseimages_DATA = \
	pkg/base1/images/play.png \
	pkg/base1/images/eject.png \
	pkg/base1/images/stop.png \
	$(NULL)

basefontsdir = $(pkgdatadir)/base1/fonts
basefonts_DATA = \
	pkg/base1/fonts/fontawesome.woff.gz \
	pkg/base1/fonts/patternfly.woff.gz \
	pkg/base1/fonts/glyphicons.woff.gz \
	$(NULL)

basefontsdebugdir = $(DBGDIR)$(basefontsdir)
basefontsdebug_DATA = \
	pkg/base1/fonts/fontawesome.woff \
	pkg/base1/fonts/patternfly.woff \
	pkg/base1/fonts/glyphicons.woff \
	$(NULL)

base_TESTS = \
	pkg/base1/test-base64.html \
	pkg/base1/test-utf8.html \
	pkg/base1/test-chan.html \
	pkg/base1/test-echo.html \
	pkg/base1/test-async.html \
	pkg/base1/test-no-jquery.html \
	pkg/base1/test-spawn.html \
	pkg/base1/test-spawn-proc.html \
	pkg/base1/test-http.html \
	pkg/base1/test-dbus.html \
	pkg/base1/test-location.html \
	pkg/base1/test-framed.html \
	pkg/base1/test-locale.html \
	pkg/base1/test-format.html \
	pkg/base1/test-file.html \
	pkg/base1/test-user.html \
	pkg/base1/test-time.html \
	pkg/base1/test-permissions.html \
	$(NULL)

TESTS += $(base_TESTS)

CLEANFILES += \
	pkg/base1/bundle.min.js \
	pkg/base1/term.min.js \
	$(base_BUNDLE) \
	$(base_GEN) \
	$(NULL)

EXTRA_DIST += \
	pkg/base1/bundle.min.js \
	pkg/base1/jquery.min.js \
	pkg/base1/require.min.js \
	pkg/base1/mustache.min.js \
	pkg/base1/term.min.js \
	$(base_BUNDLE) \
	$(base_DATA) \
	$(basedebug_DATA) \
	$(baseimages_DATA) \
	$(basefonts_DATA) \
	$(basefontsdebug_DATA) \
	$(base_TESTS) \
	$(NULL)

BASE_LN = cd $(srcdir)/pkg/base1; ln -sf
FONTS_LN = cd $(srcdir)/pkg/base1/fonts; ln -sf
VX = v*[0-9]

update-lib::
	$(srcdir)/tools/jsbundle $(srcdir)/pkg/base1/jquery.js \
	    $(srcdir)/lib/jquery.$(VX).js \
	    $(srcdir)/lib/bootstrap.$(VX).js \
	    $(srcdir)/lib/bootstrap-select.$(VX).js \
	    $(srcdir)/lib/bootstrap-datepicker.$(VX).js \
	    $(srcdir)/lib/jquery-flot.$(VX).js \
	    $(srcdir)/lib/jquery-flot-selection.$(VX).js \
	    $(srcdir)/lib/jquery-flot-time.$(VX).js \
	    $(srcdir)/lib/attrchange.js
	$(srcdir)/tools/jsbundle $(srcdir)/pkg/base1/jquery.min.js \
	    $(srcdir)/lib/jquery.$(VX).min.js \
	    $(srcdir)/lib/bootstrap.$(VX).min.js \
	    $(srcdir)/lib/bootstrap-select.$(VX).min.js \
	    $(srcdir)/lib/bootstrap-datepicker.$(VX).min.js \
	    $(srcdir)/lib/jquery-flot.$(VX).min.js \
	    $(srcdir)/lib/jquery-flot-selection.$(VX).min.js \
	    $(srcdir)/lib/jquery-flot-time.$(VX).min.js \
	    $(srcdir)/lib/attrchange.min.js
	$(srcdir)/tools/jsbundle $(srcdir)/pkg/base1/require.js \
	    $(srcdir)/lib/requirejs.$(VX).js \
	    $(srcdir)/pkg/base1/require-config.js \
	    $(srcdir)/pkg/base1/require-loaders.js
	$(srcdir)/tools/jsbundle $(srcdir)/pkg/base1/require.min.js \
	    $(srcdir)/lib/requirejs.$(VX).min.js \
	    $(srcdir)/pkg/base1/require-config.js \
	    $(srcdir)/pkg/base1/require-loaders.js
	$(srcdir)/tools/cssbundle -o $(srcdir)/pkg/base1/patternfly.css \
	    $(srcdir)/lib/patternfly.$(VX).css \
	    $(srcdir)/lib/bootstrap-datepicker.$(VX).css
	$(BASE_LN) ../../lib/mustache.$(VX).js mustache.js
	$(BASE_LN) ../../lib/mustache.$(VX).min.js mustache.min.js
	$(BASE_LN) ../../lib/term.$(VX).js term.js
	$(FONTS_LN) ../../../lib/fontawesome.$(VX).woff fontawesome.woff
	$(FONTS_LN) ../../../lib/patternfly.$(VX).woff patternfly.woff
	$(FONTS_LN) ../../../lib/glyphicons-halflings.$(VX).woff glyphicons.woff

# Never recreate these files
pkg/base1/jquery.min.js:
	@true
pkg/base1/mustache.min.js:
	@true
pkg/base1/require.min.js:
	@true
