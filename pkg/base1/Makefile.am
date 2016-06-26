LINGUAS = ca de da pl pt_BR tr uk

# Mustache is distributed for compat reasons

basedir = $(pkgdatadir)/base1
nodist_base_DATA = \
	pkg/base1/cockpit.min.css.gz \
	pkg/base1/require.min.js.gz \
	pkg/base1/mustache.min.js.gz \
	pkg/base1/jquery.min.js.gz \
	pkg/base1/cockpit.min.js.gz \
	pkg/base1/bundle.min.js.gz \
	$(NULL)
base_DATA = \
	pkg/base1/manifest.json \
	$(NULL)

basedebugdir = $(debugdir)$(basedir)
basedebug_DATA = \
	pkg/base1/bundle.js \
	pkg/base1/cockpit.css \
	pkg/base1/mustache.js \
	pkg/base1/patternfly.css \
	pkg/base1/patternfly-additions.css \
	pkg/base1/require.js \
	pkg/base1/jquery.js \
	pkg/base1/cockpit.js \
	$(NULL)

base_BUNDLE = \
	pkg/base1/require.min.js \
	pkg/base1/cockpit.min.js \
	pkg/base1/jquery.min.js \
	$(NULL)

pkg/base1/bundle.min.js: $(base_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^
pkg/base1/jquery.min.js: pkg/base1/jquery.js
	$(MIN_JS_RULE)
pkg/base1/mustache.js: lib/mustache/mustache.js
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && cp $^ $@.tmp && mv $@.tmp $@
pkg/base1/mustache.min.js: pkg/base1/mustache.js
	$(MIN_JS_RULE)

install-data-local::
	$(MKDIR_P) $(DESTDIR)$(basedebugdir)
	$(LN_S) -f require.js $(DESTDIR)$(basedebugdir)/bundle.js

basefontsdir = $(pkgdatadir)/base1/fonts
basefonts_DATA = \
	pkg/base1/fonts/fontawesome.woff \
	pkg/base1/fonts/patternfly.woff \
	pkg/base1/fonts/glyphicons.woff \
	$(NULL)

base_TESTS = \
	pkg/base1/test-base64.html \
	pkg/base1/test-utf8.html \
	pkg/base1/test-events.html \
	pkg/base1/test-chan.html \
	pkg/base1/test-echo.html \
	pkg/base1/test-async.html \
	pkg/base1/test-no-jquery.html \
	pkg/base1/test-spawn.html \
	pkg/base1/test-spawn-proc.html \
	pkg/base1/test-http.html \
	pkg/base1/test-dbus.html \
	pkg/base1/test-dbus-address.html \
	pkg/base1/test-dbus-framed.html \
	pkg/base1/test-external.html \
	pkg/base1/test-location.html \
	pkg/base1/test-framed.html \
	pkg/base1/test-locale.html \
	pkg/base1/test-format.html \
	pkg/base1/test-file.html \
	pkg/base1/test-metrics.html \
	pkg/base1/test-user.html \
	pkg/base1/test-permissions.html \
	pkg/base1/test-series.html \
	pkg/base1/test-cache.html \
	pkg/base1/test-framed-cache.html \
	pkg/base1/test-websocket.html \
	pkg/base1/test-stub.html \
	$(NULL)

TESTS += $(base_TESTS)

CLEANFILES += \
	pkg/base1/bundle.min.js \
	pkg/base1/cockpit.min.js \
	pkg/base1/cockpit.min.css \
	pkg/base1/jquery.min.js \
	pkg/base1/mustache.min.js \
	pkg/base1/require.min.js \
	$(nodist_base_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/base1/bundle.min.js \
	pkg/base1/cockpit.min.css \
	pkg/base1/jquery.min.js \
	pkg/base1/require.min.js \
	pkg/base1/mustache.js \
	pkg/base1/mustache.min.js \
	pkg/base1/test-dbus-common.js \
	$(base_BUNDLE) \
	$(NULL)

update-lib:: update-bower
	sed -f $(srcdir)/tools/patternfly.sed \
		$(BOWER)/patternfly/dist/css/patternfly.css > $(srcdir)/pkg/base1/patternfly.css
	sed -f $(srcdir)/tools/patternfly.sed \
		$(BOWER)/patternfly/dist/css/patternfly-additions.css > $(srcdir)/pkg/base1/patternfly-additions.css
	$(JSMODULE) -o $(srcdir)/pkg/base1/jquery.js \
	    $(BOWER)/jquery/dist/jquery.js \
	    $(BOWER)/bootstrap/dist/js/bootstrap.js \
	    $(BOWER)/patternfly/dist/js/patternfly.js \
	    $(NULL)
	$(JSMODULE) -o $(srcdir)/pkg/base1/require.js \
	    $(srcdir)/pkg/base1/require-config.js \
	    $(BOWER)/requirejs/require.js \
	    $(srcdir)/pkg/base1/require-loaders.js
