LINGUAS = de da pl

basedir = $(pkgdatadir)/base1
base_GEN = \
	$(addprefix po/po.,$(addsuffix .js,$(LINGUAS))) \
	$(NULL)
nodist_base_DATA = \
	assets/base1/angular.min.js.gz \
	assets/base1/cockpit.min.css.gz \
	assets/base1/po.js.gz \
	assets/base1/require.min.js.gz \
	assets/base1/term.min.js.gz \
	assets/base1/moment.min.js.gz \
	assets/base1/mustache.min.js.gz \
	assets/base1/jquery.min.js.gz \
	assets/base1/cockpit.min.js.gz \
	assets/base1/bundle.min.js.gz \
	$(base_GEN:.js=.js.gz) \
	$(NULL)
base_DATA = \
	assets/base1/manifest.json \
	$(NULL)

basedebugdir = $(debugdir)$(basedir)
basedebug_DATA = \
	assets/base1/angular.js \
	assets/base1/angular-patternfly.css \
	assets/base1/bootstrap-datepicker.js \
	assets/base1/bootstrap-select.js \
	assets/base1/bootstrap-combobox.js \
	assets/base1/bundle.js \
	assets/base1/cockpit.css \
	assets/base1/patternfly.css \
	assets/base1/patternfly-additions.css \
	assets/base1/po.js \
	assets/base1/require.js \
	assets/base1/patterns.js \
	assets/base1/term.js \
	assets/base1/moment.js \
	assets/base1/mustache.js \
	assets/base1/jquery.js \
	assets/base1/cockpit.js \
	$(base_GEN) \
	$(NULL)

base_BUNDLE = \
	assets/base1/require.min.js \
	assets/base1/cockpit.min.js \
	assets/base1/jquery.min.js \
	assets/base1/bootstrap-datepicker.min.js \
	assets/base1/bootstrap-select.min.js \
	assets/base1/bootstrap-combobox.min.js \
	assets/base1/mustache.min.js \
	assets/base1/patterns.min.js \
	$(NULL)

assets/base1/bundle.min.js: $(base_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^
assets/base1/term.min.js: assets/base1/term.js
	@$(MKDIR_P) $(dir $@)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/uglifyjs $< --mangle > $@.tmp && $(MV) $@.tmp $@

install-data-local::
	$(MKDIR_P) $(DESTDIR)$(basedebugdir)
	$(LN_S) -f require.js $(DESTDIR)$(basedebugdir)/bundle.js

basefontsdir = $(pkgdatadir)/base1/fonts
basefonts_DATA = \
	assets/base1/fonts/fontawesome.woff \
	assets/base1/fonts/patternfly.woff \
	assets/base1/fonts/glyphicons.woff \
	$(NULL)

base_TESTS = \
	assets/base1/test-base64.html \
	assets/base1/test-utf8.html \
	assets/base1/test-chan.html \
	assets/base1/test-echo.html \
	assets/base1/test-async.html \
	assets/base1/test-no-jquery.html \
	assets/base1/test-spawn.html \
	assets/base1/test-spawn-proc.html \
	assets/base1/test-http.html \
	assets/base1/test-dbus.html \
	assets/base1/test-dbus-address.html \
	assets/base1/test-dbus-framed.html \
	assets/base1/test-location.html \
	assets/base1/test-framed.html \
	assets/base1/test-locale.html \
	assets/base1/test-format.html \
	assets/base1/test-file.html \
	assets/base1/test-metrics.html \
	assets/base1/test-user.html \
	assets/base1/test-time.html \
	assets/base1/test-permissions.html \
	assets/base1/test-series.html \
	assets/base1/test-cache.html \
	assets/base1/test-framed-cache.html \
	$(NULL)

TESTS += $(base_TESTS)

CLEANFILES += \
	assets/base1/bundle.min.js \
	assets/base1/term.min.js \
	assets/base1/cockpit.min.js \
	assets/base1/patterns.min.js \
	assets/base1/bootstrap-combobox.min.js \
	$(base_GEN) \
	$(nodist_base_DATA) \
	$(NULL)

EXTRA_DIST += \
	assets/base1/angular.min.js \
	assets/base1/bootstrap-select.min.js \
	assets/base1/bootstrap-datepicker.min.js \
	assets/base1/bootstrap-combobox.min.js \
	assets/base1/bundle.min.js \
	assets/base1/cockpit.min.css \
	assets/base1/jquery.min.js \
	assets/base1/require.min.js \
	assets/base1/mustache.min.js \
	assets/base1/moment.min.js \
	assets/base1/term.min.js \
	assets/base1/test-dbus-common.js \
	$(base_BUNDLE) \
	$(base_DATA) \
	$(basedebug_DATA) \
	$(baseimages_DATA) \
	$(basefonts_DATA) \
	$(basefontsdebug_DATA) \
	$(base_TESTS) \
	$(NULL)

update-lib:: update-bower
	$(srcdir)/tools/uglifyjs $(BOWER)/jquery-flot/jquery.flot.js > jquery.flot.min.js
	$(srcdir)/tools/uglifyjs $(BOWER)/jquery-flot/jquery.flot.selection.js > jquery.flot.selection.min.js
	$(srcdir)/tools/uglifyjs $(BOWER)/jquery-flot/jquery.flot.time.js > jquery.flot.time.min.js
	$(srcdir)/tools/uglifyjs $(BOWER)/jquery-amend/jquery-amend.js > jquery-amend.min.js
	sed -f $(srcdir)/tools/patternfly.sed \
		$(BOWER)/patternfly/dist/css/patternfly.css > $(srcdir)/assets/base1/patternfly.css
	sed -f $(srcdir)/tools/patternfly.sed \
		$(BOWER)/patternfly/dist/css/patternfly-additions.css > $(srcdir)/assets/base1/patternfly-additions.css
	sed -f $(srcdir)/tools/patternfly.sed \
		$(BOWER)/angular-patternfly/dist/styles/angular-patternfly.css > $(srcdir)/assets/base1/angular-patternfly.css
	$(JSMODULE) -o $(srcdir)/assets/base1/jquery.js \
	    $(BOWER)/jquery/dist/jquery.js \
	    $(BOWER)/patternfly/components/bootstrap/dist/js/bootstrap.js \
	    $(BOWER)/patternfly/dist/js/patternfly.js \
	    $(BOWER)/jquery-flot/jquery.flot.js \
	    $(BOWER)/jquery-flot/jquery.flot.selection.js \
	    $(BOWER)/jquery-flot/jquery.flot.time.js \
	    $(BOWER)/jquery-amend/jquery-amend.js \
	    $(srcdir)/assets/base1/jquery-scoped.js \
	    $(srcdir)/assets/base1/attrchange.js
	$(JSMODULE) -o $(srcdir)/assets/base1/jquery.min.js \
	    $(BOWER)/jquery/dist/jquery.min.js \
	    $(BOWER)/patternfly/components/bootstrap/dist/js/bootstrap.min.js \
	    $(BOWER)/patternfly/dist/js/patternfly.min.js \
	    jquery.flot.min.js \
	    jquery.flot.selection.min.js \
	    jquery.flot.time.min.js \
	    jquery-amend.min.js \
	    $(srcdir)/assets/base1/jquery-scoped.js \
	    $(srcdir)/assets/base1/attrchange.min.js
	$(JSMODULE) -o $(srcdir)/assets/base1/bootstrap-select.js \
	    $(BOWER)/patternfly/components/bootstrap-select/dist/js/bootstrap-select.js
	$(JSMODULE) -o $(srcdir)/assets/base1/bootstrap-select.min.js \
	    $(BOWER)/patternfly/components/bootstrap-select/dist/js/bootstrap-select.min.js
	$(JSMODULE) -m -d jquery -o $(srcdir)/assets/base1/bootstrap-datepicker.js \
	    $(BOWER)/patternfly/components/bootstrap-datepicker/dist/js/bootstrap-datepicker.js
	$(JSMODULE) -m -d jquery -o $(srcdir)/assets/base1/bootstrap-datepicker.min.js \
	    $(BOWER)/patternfly/components/bootstrap-datepicker/dist/js/bootstrap-datepicker.min.js
	$(JSMODULE) -m -d jquery -o $(srcdir)/assets/base1/bootstrap-combobox.js \
	    $(BOWER)/patternfly/components/bootstrap-combobox/js/bootstrap-combobox.js
	$(srcdir)/tools/uglifyjs $(BOWER)/requirejs/require.js > require.min.js
	$(JSMODULE) -o $(srcdir)/assets/base1/require.js \
	    $(BOWER)/requirejs/require.js \
	    $(srcdir)/assets/base1/require-config.js \
	    $(srcdir)/assets/base1/require-loaders.js
	$(JSMODULE) -o $(srcdir)/assets/base1/require.min.js \
	    require.min.js \
	    $(srcdir)/assets/base1/require-config.js \
	    $(srcdir)/assets/base1/require-loaders.js
	$(JSMODULE) -o $(srcdir)/assets/base1/mustache.js \
		$(BOWER)/mustache/mustache.js
	$(srcdir)/tools/uglifyjs $(BOWER)/mustache/mustache.js > \
		$(srcdir)/assets/base1/mustache.min.js
	$(srcdir)/tools/uglifyjs $(BOWER)/requirejs/require.js > require.min.js
	$(JSMODULE) -o $(srcdir)/assets/base1/require.js \
	    $(BOWER)/requirejs/require.js \
	    $(srcdir)/assets/base1/require-config.js \
	    $(srcdir)/assets/base1/require-loaders.js
	$(JSMODULE) -o $(srcdir)/assets/base1/require.min.js \
	    require.min.js \
	    $(srcdir)/assets/base1/require-config.js \
	    $(srcdir)/assets/base1/require-loaders.js
	$(JSMODULE) -o $(srcdir)/assets/base1/mustache.js \
		$(BOWER)/mustache/mustache.js
	$(srcdir)/tools/uglifyjs $(BOWER)/mustache/mustache.js > \
		$(srcdir)/assets/base1/mustache.min.js
	$(JSMODULE) -m -a window.Terminal -o $(srcdir)/assets/base1/term.js \
	    $(BOWER)/term.js/src/term.js
	cp $(BOWER)/patternfly/dist/fonts/PatternFlyIcons-webfont.woff \
		$(srcdir)/assets/base1/fonts/patternfly.woff
	cp $(BOWER)/patternfly/components/bootstrap/fonts/glyphicons-halflings-regular.woff \
		$(srcdir)/assets/base1/fonts/glyphicons.woff
	cp $(BOWER)/patternfly/components/font-awesome/fonts/fontawesome-webfont.woff \
		$(srcdir)/assets/base1/fonts/fontawesome.woff
	$(JSMODULE) -m -a window.angular -d jquery -o $(srcdir)/assets/base1/angular.js \
	    $(BOWER)/angular/angular.js \
	    $(BOWER)/angular-route/angular-route.js \
	    $(BOWER)/angular-animate/angular-animate.js \
	    $(BOWER)/angular-bootstrap/ui-bootstrap.js \
	    $(BOWER)/angular-bootstrap/ui-bootstrap-tpls.js \
	    $(BOWER)/angular-patternfly/dist/angular-patternfly.js
	$(JSMODULE) -m -a window.angular -d jquery -o $(srcdir)/assets/base1/angular.min.js \
	    $(BOWER)/angular/angular.min.js \
	    $(BOWER)/angular-animate/angular-animate.min.js \
	    $(BOWER)/angular-route/angular-route.min.js \
	    $(BOWER)/angular-bootstrap/ui-bootstrap.min.js \
	    $(BOWER)/angular-bootstrap/ui-bootstrap-tpls.min.js \
	    $(BOWER)/angular-patternfly/dist/angular-patternfly.min.js
	$(JSMODULE) -o $(srcdir)/assets/base1/moment.js \
		$(BOWER)/momentjs/moment.js
	$(JSMODULE) -o $(srcdir)/assets/base1/moment.min.js \
		$(BOWER)/momentjs/min/moment.min.js

# Never recreate these files
assets/base1/angular.min.js:
	@true
assets/base1/jquery.min.js:
	@true
assets/base1/mustache.min.js:
	@true
assets/base1/require.min.js:
	@true
assets/base1/bootstrap-select.min.js:
	@true
assets/base1/bootstrap-datepicker.min.js:
	@true
assets/base1/moment.min.js:
	@true
