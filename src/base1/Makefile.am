# Mustache is distributed for compat reasons

basedir = $(pkgdatadir)/base1
nodist_base_DATA = \
	dist/base1/cockpit.min.css.gz \
	dist/base1/patternfly.min.css.gz \
	dist/base1/require.min.js.gz \
	dist/base1/mustache.min.js.gz \
	dist/base1/jquery.min.js.gz \
	dist/base1/cockpit.min.js.gz \
	$(NULL)
base_DATA = \
	dist/base1/manifest.json \
	$(NULL)

basedebugdir = $(debugdir)$(basedir)
basedebug_DATA = \
	dist/base1/cockpit.min.css.map \
	dist/base1/patternfly.min.css.map \
	dist/base1/mustache.min.js.map \
	dist/base1/require.min.js.map \
	dist/base1/jquery.min.js.map \
	dist/base1/cockpit.min.js.map \
	$(NULL)

CLEAN_CSS = $(srcdir)/node_modules/.bin/cleancss

MIN_JS_RULE = \
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/tools/missing $(UGLIFY_JS) $^ --mangle --comments 'preserve' --beautify \
		--source-map $@.map --source-map-url $(notdir $@).map --source-map-include-sources > $@.tmp && \
	$(MV) $@.tmp $@

dist/base1/cockpit.min.css: src/base1/cockpit.css
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/tools/missing $(CLEAN_CSS) --keep-line-breaks --output=$@ --skip-import --source-map --source-map-inline-sources $^
dist/base1/patternfly.min.css: dist/base1/patternfly-base.css dist/base1/patternfly-additions.css
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/tools/missing $(CLEAN_CSS) --keep-line-breaks --output=$@ --source-map --source-map-inline-sources $^
dist/base1/require.js: src/base1/deprecated.js src/base1/require-config.js src/base1/require-loaders.js
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	cat $(srcdir)/src/base1/deprecated.js $(srcdir)/src/base1/require-config.js $(BOWER)/requirejs/require.js $(srcdir)/src/base1/require-loaders.js > $@.tmp && $(MV) $@.tmp $@
dist/base1/require.min.js: dist/base1/require.js
	$(MIN_JS_RULE)
dist/base1/jquery.js:
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	cat $(BOWER)/jquery/dist/jquery.js $(BOWER)/bootstrap/dist/js/bootstrap.js $(BOWER)/patternfly/dist/js/patternfly.js > $@.tmp && $(MV) $@.tmp $@
dist/base1/jquery.min.js: dist/base1/jquery.js
	$(MIN_JS_RULE)
dist/base1/cockpit.js: src/base1/cockpit.js
	$(V_CHECK) $(srcdir)/tools/missing $(srcdir)/tools/jshint $<
	$(COPY_RULE)
dist/base1/cockpit.min.js: dist/base1/cockpit.js
	$(MIN_JS_RULE)
dist/base1/mustache.js: src/base1/deprecated.js
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cat $(srcdir)/src/base1/deprecated.js $(BOWER)/mustache/mustache.js > $@.tmp && $(MV) $@.tmp $@
dist/base1/mustache.min.js: dist/base1/mustache.js
	$(MIN_JS_RULE)
dist/base1/manifest.json: src/base1/manifest.json
	$(COPY_RULE)


# All map files are built as side effects of minification
dist/base1/require.min.js.map: dist/base1/require.min.js

dist/base1/cockpit.min.js.map: dist/base1/cockpit.min.js

dist/base1/jquery.min.js.map: dist/base1/jquery.min.js

dist/base1/mustache.min.js.map: dist/base1/mustache.min.js

dist/base1/cockpit.min.css.map: dist/base1/cockpit.min.css

dist/base1/patternfly.min.css.map: dist/base1/patternfly.min.css

# Modify the patternfly files appropriately
dist/base1/patternfly-base.css: dist/base1/patternfly.css.map
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	sed -f $(srcdir)/tools/patternfly.sed $(BOWER)/patternfly/dist/css/patternfly.css > $@.tmp && $(MV) $@.tmp $@
dist/base1/patternfly.css.map:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(BOWER)/patternfly/dist/css/patternfly.css.map $@.tmp && $(MV) $@.tmp $@
dist/base1/patternfly-additions.css: dist/base1/patternfly-additions.css.map
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	sed -f $(srcdir)/tools/patternfly.sed $(BOWER)/patternfly/dist/css/patternfly-additions.css > $@.tmp && $(MV) $@.tmp $@
dist/base1/patternfly-additions.css.map:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(BOWER)/patternfly/dist/css/patternfly-additions.css.map $@.tmp && $(MV) $@.tmp $@

dist/base1/fonts/fontawesome.woff:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(BOWER)/patternfly/dist/fonts/fontawesome-webfont.woff $@.tmp && $(MV) $@.tmp $@
dist/base1/fonts/glyphicons.woff:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(BOWER)/patternfly/dist/fonts/glyphicons-halflings-regular.woff $@.tmp && $(MV) $@.tmp $@
dist/base1/fonts/patternfly.woff:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(BOWER)/patternfly/dist/fonts/PatternFlyIcons-webfont.woff $@.tmp && $(MV) $@.tmp $@

basefontsdir = $(pkgdatadir)/base1/fonts
basefonts_DATA = \
	dist/base1/fonts/fontawesome.woff \
	dist/base1/fonts/patternfly.woff \
	dist/base1/fonts/glyphicons.woff \
	$(NULL)

install-data-local::
	$(LN_S) -nf require.min.js.gz $(DESTDIR)$(pkgdatadir)/base1/bundle.min.js.gz

# Tests run with QUnit

base_QUNIT_TESTS = \
	dist/base1/test-base64.html \
	dist/base1/test-utf8.html \
	dist/base1/test-events.html \
	dist/base1/test-chan.html \
        dist/base1/test-dbus.html \
	dist/base1/test-dbus-address.html \
	dist/base1/test-echo.html \
	dist/base1/test-spawn.html \
	dist/base1/test-spawn-proc.html \
	dist/base1/test-http.html \
	dist/base1/test-external.html \
	dist/base1/test-location.html \
	dist/base1/test-locale.html \
	dist/base1/test-format.html \
	dist/base1/test-file.html \
	dist/base1/test-metrics.html \
	dist/base1/test-user.html \
	dist/base1/test-permissions.html \
	dist/base1/test-series.html \
	dist/base1/test-cache.html \
	dist/base1/test-websocket.html \
	dist/base1/test-stub.html \
	dist/base1/test-browser-storage.html \
	$(NULL)

base_QUNIT_DEPS = \
	dist/base1/qunit.css \
	dist/base1/qunit.js \
	dist/base1/test-dbus-common.js \
	src/base1/qunit-template.html \
	src/base1/test-dbus-common.js \
	$(NULL)

dist/base1/qunit.js:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cat $(BOWER)/qunit/qunit/qunit.js \
	    $(BOWER)/qunit-tap/lib/qunit-tap.js \
            $(srcdir)/pkg/lib/qunit-config.js > $@.tmp && $(MV) $@.tmp $@

dist/base1/qunit.css:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(BOWER)/qunit/qunit/qunit.css $@.tmp && $(MV) $@.tmp $@

dist/base1/test-dbus-common.js: src/base1/test-dbus-common.js
	$(V_CHECK) $(srcdir)/tools/missing $(srcdir)/tools/jshint $<
	$(COPY_RULE)

$(base_QUNIT_TESTS): dist/base1/test-%.html: src/base1/test-%.js $(base_QUNIT_DEPS)
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/tools/missing $(srcdir)/tools/jshint $< && \
	cp -L $< $@.tmp.js && $(MV) $@.tmp.js $(dir $@)/$(notdir $<) && \
	$(SED_TEST_TEMPLATE) $(srcdir)/src/base1/qunit-template.html > $@.tmp && $(MV) $@.tmp $@

# Simple tests run without QUnit

base_SIMPLE_TESTS = \
	dist/base1/test-no-jquery.html \
	dist/base1/test-framed-cache.html \
	dist/base1/test-framed.html \
	dist/base1/test-dbus-framed.html \
	$(NULL)

base_SIMPLE_DEPS = \
	dist/base1/simple-tap.js \
	src/base1/simple-template.html \
	src/base1/simple-tap.js \
	$(NULL)

dist/base1/simple-tap.js: src/base1/simple-tap.js
	$(V_CHECK) $(srcdir)/tools/missing $(srcdir)/tools/jshint $<
	$(COPY_RULE)

$(base_SIMPLE_TESTS): dist/base1/test-%.html: src/base1/test-%.js $(base_SIMPLE_DEPS)
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/tools/missing $(srcdir)/tools/jshint $< && \
	cp -L $< $@.tmp.js && $(MV) $@.tmp.js $(dir $@)/$(notdir $<) && \
	$(SED_TEST_TEMPLATE) $(srcdir)/src/base1/simple-template.html > $@.tmp && $(MV) $@.tmp $@

dist/base1/test-%.js: dist/base1/test-%.html
	@true

# A html-webpack-plugin workalike for tests not built by webpack

SED_TEST_TEMPLATE = sed -e 's,[@]TEST[@],$(notdir $<),g'

base_TESTS = $(base_QUNIT_TESTS) $(base_SIMPLE_TESTS)
base_TESTS_DEPS = $(base_QUNIT_DEPS) $(base_SIMPLE_DEPS)
base_TESTS_JAVASCRIPT = $(base_TESTS:.html=.js)
base_TESTS_SOURCE = $(subst dist/,src/,$(base_TESTS_JAVASCRIPT))

TESTS += $(base_TESTS)
noinst_SCRIPTS += $(base_TESTS)

EXTRA_DIST += \
	dist/base1/cockpit.js \
	dist/base1/cockpit.min.css \
	dist/base1/cockpit.min.css.map \
	dist/base1/cockpit.min.js \
	dist/base1/cockpit.min.js.map \
	dist/base1/jquery.js \
	dist/base1/jquery.min.js \
	dist/base1/jquery.min.js.map \
	dist/base1/mustache.js \
	dist/base1/mustache.min.js \
	dist/base1/mustache.min.js.map \
	dist/base1/patternfly-base.css \
	dist/base1/patternfly.min.css \
	dist/base1/patternfly.min.css.map \
	dist/base1/patternfly.css.map \
	dist/base1/patternfly-additions.css \
	dist/base1/patternfly-additions.css.map \
	dist/base1/require.js \
	dist/base1/require.min.js \
	dist/base1/require.min.js.map \
	dist/base1/simple-tap.js \
	src/base1/cockpit.css \
	src/base1/cockpit.js \
	src/base1/deprecated.js \
	src/base1/manifest.json \
	src/base1/require-config.js \
	src/base1/require-loaders.js \
	src/base1/simple-tap.js \
	src/base1/test-dbus-common.js \
	$(base_DATA) \
	$(basefonts_DATA) \
	$(base_TESTS) \
	$(base_TESTS_DEPS) \
	$(base_TESTS_SOURCE) \
	$(base_TESTS_JAVASCRIPT) \
	$(NULL)
