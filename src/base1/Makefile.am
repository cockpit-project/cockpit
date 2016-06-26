LINGUAS = ca de da pl pt_BR tr uk

# Mustache is distributed for compat reasons

basedir = $(pkgdatadir)/base1
nodist_base_DATA = \
	src/base1/cockpit.min.css.gz \
	src/base1/require.min.js.gz \
	src/base1/mustache.min.js.gz \
	src/base1/jquery.min.js.gz \
	src/base1/cockpit.min.js.gz \
	src/base1/bundle.min.js.gz \
	$(NULL)
base_DATA = \
	src/base1/manifest.json \
	$(NULL)

basedebugdir = $(debugdir)$(basedir)
basedebug_DATA = \
	src/base1/bundle.js \
	src/base1/cockpit.css \
	src/base1/mustache.js \
	src/base1/patternfly.css \
	src/base1/patternfly-additions.css \
	src/base1/require.js \
	src/base1/jquery.js \
	src/base1/cockpit.js \
	$(NULL)

base_BUNDLE = \
	src/base1/require.min.js \
	src/base1/cockpit.min.js \
	src/base1/jquery.min.js \
	$(NULL)

src/base1/bundle.min.js: $(base_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^
src/base1/jquery.min.js: src/base1/jquery.js
	$(MIN_JS_RULE)
src/base1/mustache.js: lib/mustache/mustache.js
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && cp $^ $@.tmp && mv $@.tmp $@
src/base1/mustache.min.js: src/base1/mustache.js
	$(MIN_JS_RULE)

install-data-local::
	$(MKDIR_P) $(DESTDIR)$(basedebugdir)
	$(LN_S) -f require.js $(DESTDIR)$(basedebugdir)/bundle.js

basefontsdir = $(pkgdatadir)/base1/fonts
basefonts_DATA = \
	src/base1/fonts/fontawesome.woff \
	src/base1/fonts/patternfly.woff \
	src/base1/fonts/glyphicons.woff \
	$(NULL)

base_TESTS = \
	src/base1/test-base64.html \
	src/base1/test-utf8.html \
	src/base1/test-events.html \
	src/base1/test-chan.html \
	src/base1/test-echo.html \
	src/base1/test-async.html \
	src/base1/test-no-jquery.html \
	src/base1/test-spawn.html \
	src/base1/test-spawn-proc.html \
	src/base1/test-http.html \
	src/base1/test-dbus.html \
	src/base1/test-dbus-address.html \
	src/base1/test-dbus-framed.html \
	src/base1/test-external.html \
	src/base1/test-location.html \
	src/base1/test-framed.html \
	src/base1/test-locale.html \
	src/base1/test-format.html \
	src/base1/test-file.html \
	src/base1/test-metrics.html \
	src/base1/test-user.html \
	src/base1/test-permissions.html \
	src/base1/test-series.html \
	src/base1/test-cache.html \
	src/base1/test-framed-cache.html \
	src/base1/test-websocket.html \
	src/base1/test-stub.html \
	$(NULL)

TESTS += $(base_TESTS)

CLEANFILES += \
	src/base1/bundle.min.js \
	src/base1/cockpit.min.js \
	src/base1/cockpit.min.css \
	src/base1/jquery.min.js \
	src/base1/mustache.min.js \
	src/base1/require.min.js \
	$(nodist_base_DATA) \
	$(NULL)

EXTRA_DIST += \
	src/base1/bundle.min.js \
	src/base1/cockpit.min.css \
	src/base1/jquery.min.js \
	src/base1/require.min.js \
	src/base1/mustache.js \
	src/base1/mustache.min.js \
	src/base1/test-dbus-common.js \
	$(base_BUNDLE) \
	$(base_DATA) \
	$(base_TESTS) \
	$(basedebug_DATA) \
	$(basefonts_DATA) \
	$(NULL)

update-lib:: update-bower
	sed -f $(srcdir)/tools/patternfly.sed \
		$(BOWER)/patternfly/dist/css/patternfly.css > $(srcdir)/src/base1/patternfly.css
	sed -f $(srcdir)/tools/patternfly.sed \
		$(BOWER)/patternfly/dist/css/patternfly-additions.css > $(srcdir)/src/base1/patternfly-additions.css
	$(JSMODULE) -o $(srcdir)/src/base1/jquery.js \
	    $(BOWER)/jquery/dist/jquery.js \
	    $(BOWER)/bootstrap/dist/js/bootstrap.js \
	    $(BOWER)/patternfly/dist/js/patternfly.js \
	    $(NULL)
	$(JSMODULE) -o $(srcdir)/src/base1/require.js \
	    $(srcdir)/src/base1/require-config.js \
	    $(BOWER)/requirejs/require.js \
	    $(srcdir)/src/base1/require-loaders.js
