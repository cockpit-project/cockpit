# Mustache is distributed for compat reasons

basedir = $(pkgdatadir)/base1
nodist_base_DATA = \
	dist/base1/cockpit.min.css.gz \
	dist/base1/patternfly.min.css.gz \
	dist/base1/require.min.js.gz \
	dist/base1/mustache.min.js.gz \
	dist/base1/jquery.min.js.gz \
	dist/base1/cockpit.min.js.gz \
	dist/base1/bundle.min.js.gz \
	$(NULL)
base_DATA = \
	dist/base1/manifest.json \
	$(NULL)

basedebugdir = $(debugdir)$(basedir)
basedebug_DATA = \
	dist/base1/bundle.min.js.map \
	dist/base1/cockpit.min.css.map \
	dist/base1/patternfly.min.css.map \
	dist/base1/mustache.min.js.map \
	dist/base1/require.min.js.map \
	dist/base1/jquery.min.js.map \
	dist/base1/cockpit.min.js.map \
	$(NULL)

CLEAN_CSS = $(srcdir)/node_modules/.bin/cleancss

UGLIFY_JS = $(srcdir)/node_modules/.bin/uglifyjs

MIN_JS_RULE = \
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/tools/missing $(UGLIFY_JS) $^ --mangle \
		--source-map $@.map --source-map-url $(notdir $@).map --source-map-include-sources > $@.tmp && \
	$(MV) $@.tmp $@

dist/base1/cockpit.min.css: src/base1/cockpit.css
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/tools/missing $(CLEAN_CSS) --output=$@ --skip-import --source-map --source-map-inline-sources $^
dist/base1/patternfly.min.css: dist/base1/patternfly-base.css dist/base1/patternfly-additions.css
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/tools/missing $(CLEAN_CSS) --output=$@ --source-map --source-map-inline-sources $^
dist/base1/bundle.js: dist/base1/require.js src/base1/cockpit.js dist/base1/jquery.js
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	cat $^ > $@.tmp && $(MV) $@.tmp $@
dist/base1/bundle.min.js: dist/base1/bundle.js
	$(MIN_JS_RULE)
dist/base1/require.js: src/base1/require-config.js $(BOWER)/requirejs/require.js src/base1/require-loaders.js
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	cat $^ > $@.tmp && $(MV) $@.tmp $@
dist/base1/require.min.js: dist/base1/require.js
	$(MIN_JS_RULE)
dist/base1/jquery.js: $(BOWER)/jquery/dist/jquery.js $(BOWER)/bootstrap/dist/js/bootstrap.js $(BOWER)/patternfly/dist/js/patternfly.js
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	cat $^ > $@.tmp && $(MV) $@.tmp $@
dist/base1/jquery.min.js: dist/base1/jquery.js
	$(MIN_JS_RULE)
dist/base1/cockpit.min.js: src/base1/cockpit.js
	$(V_CHECK) $(srcdir)/tools/missing $(srcdir)/tools/jshint $<
	$(MIN_JS_RULE)
dist/base1/mustache.min.js: $(BOWER)/mustache/mustache.js
	$(MIN_JS_RULE)
dist/base1/manifest.json: src/base1/manifest.json
	$(COPY_RULE)


# All map files are built as side effects of minification
dist/base1/bundle.min.js.map: dist/base1/bundle.min.js

dist/base1/require.min.js.map: dist/base1/require.min.js

dist/base1/cockpit.min.js.map: dist/base1/cockpit.min.js

dist/base1/jquery.min.js.map: dist/base1/jquery.min.js

dist/base1/mustache.min.js.map: dist/base1/mustache.min.js

dist/base1/cockpit.min.css.map: dist/base1/cockpit.min.css

dist/base1/patternfly.min.css.map: dist/base1/patternfly.min.css

# Modify the patternfly files appropriately
dist/base1/patternfly-base.css: $(BOWER)/patternfly/dist/css/patternfly.css dist/base1/patternfly.css.map
	$(AM_V_GEN) sed -f $(srcdir)/tools/patternfly.sed $< > $@.tmp && $(MV) $@.tmp $@
dist/base1/patternfly.css.map: $(BOWER)/patternfly/dist/css/patternfly.css.map
	$(COPY_RULE)
dist/base1/patternfly-additions.css: $(BOWER)/patternfly/dist/css/patternfly-additions.css dist/base1/patternfly-additions.css.map
	$(AM_V_GEN) sed -f $(srcdir)/tools/patternfly.sed $< > $@.tmp && $(MV) $@.tmp $@
dist/base1/patternfly-additions.css.map: $(BOWER)/patternfly/dist/css/patternfly-additions.css.map
	$(COPY_RULE)

dist/base1/fonts/fontawesome.woff: $(BOWER)/patternfly/dist/fonts/fontawesome-webfont.woff
	$(COPY_RULE)
dist/base1/fonts/glyphicons.woff: $(BOWER)/patternfly/dist/fonts/glyphicons-halflings-regular.woff
	$(COPY_RULE)
dist/base1/fonts/patternfly.woff: $(BOWER)/patternfly/dist/fonts/PatternFlyIcons-webfont.woff
	$(COPY_RULE)

basefontsdir = $(pkgdatadir)/base1/fonts
basefonts_DATA = \
	dist/base1/fonts/fontawesome.woff \
	dist/base1/fonts/patternfly.woff \
	dist/base1/fonts/glyphicons.woff \
	$(NULL)

base_TESTS = \
	src/base1/test-base64.html \
	src/base1/test-utf8.html \
	src/base1/test-events.html \
	src/base1/test-chan.html \
	src/base1/test-echo.html \
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
	src/base1/test-browser-storage.html \
	$(NULL)

TESTS += $(base_TESTS)

EXTRA_DIST += \
	dist/base1/bundle.js \
	dist/base1/bundle.min.js \
	dist/base1/bundle.min.js.map \
	dist/base1/cockpit.min.css \
	dist/base1/cockpit.min.css.map \
	dist/base1/cockpit.min.js \
	dist/base1/cockpit.min.js.map \
	dist/base1/jquery.js \
	dist/base1/jquery.min.js \
	dist/base1/jquery.min.js.map \
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
	src/base1/cockpit.css \
	src/base1/cockpit.js \
	src/base1/manifest.json \
	src/base1/require-config.js \
	src/base1/require-loaders.js \
	src/base1/test-dbus-common.js \
	$(base_DATA) \
	$(base_TESTS) \
	$(basefonts_DATA) \
	$(NULL)
