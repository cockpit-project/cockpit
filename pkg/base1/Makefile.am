LINGUAS = ca de da pl pt_BR tr uk

basedir = $(pkgdatadir)/base1
base_GEN = \
	$(addprefix po/po.,$(addsuffix .js,$(LINGUAS))) \
	$(NULL)
nodist_base_DATA = \
	pkg/base1/angular.min.js.gz \
	pkg/base1/cockpit.min.css.gz \
	pkg/base1/d3.min.js.gz \
	pkg/base1/po.js.gz \
	pkg/base1/require.min.js.gz \
	pkg/base1/term.min.js.gz \
	pkg/base1/moment.min.js.gz \
	pkg/base1/mustache.min.js.gz \
	pkg/base1/jquery.min.js.gz \
	pkg/base1/cockpit.min.js.gz \
	pkg/base1/bundle.min.js.gz \
	$(base_GEN:.js=.min.js.gz) \
	$(NULL)
base_DATA = \
	pkg/base1/manifest.json \
	$(NULL)

basedebugdir = $(debugdir)$(basedir)
basedebug_DATA = \
	pkg/base1/angular.js \
	pkg/base1/angular-csp.css \
	pkg/base1/angular-patternfly.css \
	pkg/base1/bootstrap-datepicker.js \
	pkg/base1/bootstrap-select.js \
	pkg/base1/bootstrap-combobox.js \
	pkg/base1/bundle.js \
	pkg/base1/cockpit.css \
	pkg/base1/d3.js \
	pkg/base1/patternfly.css \
	pkg/base1/patternfly-additions.css \
	pkg/base1/po.js \
	pkg/base1/require.js \
	pkg/base1/patterns.js \
	pkg/base1/term.css \
	pkg/base1/term.js \
	pkg/base1/moment.js \
	pkg/base1/mustache.js \
	pkg/base1/jquery.js \
	pkg/base1/cockpit.js \
	$(base_GEN) \
	$(NULL)

base_BUNDLE = \
	pkg/base1/require.min.js \
	pkg/base1/cockpit.min.js \
	pkg/base1/jquery.min.js \
	pkg/base1/bootstrap-datepicker.min.js \
	pkg/base1/bootstrap-select.min.js \
	pkg/base1/bootstrap-combobox.min.js \
	pkg/base1/mustache.min.js \
	pkg/base1/patterns.min.js \
	$(NULL)

pkg/base1/angular.min.js: pkg/base1/angular.js
	$(MIN_JS_RULE)
pkg/base1/bootstrap-select.min.js: pkg/base1/bootstrap-select.js
	$(MIN_JS_RULE)
pkg/base1/bundle.min.js: $(base_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^
pkg/base1/d3.min.js: pkg/base1/d3.js
	$(MIN_JS_RULE)
pkg/base1/jquery.min.js: pkg/base1/jquery.js
	$(MIN_JS_RULE)
pkg/base1/moment.min.js: pkg/base1/moment.js
	$(MIN_JS_RULE)
pkg/base1/mustache.min.js: pkg/base1/mustache.js
	$(MIN_JS_RULE)
pkg/base1/term.min.js: pkg/base1/term.js
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
	pkg/base1/angular.min.js \
	pkg/base1/bootstrap-datepicker.min.js \
	pkg/base1/bootstrap-select.min.js \
	pkg/base1/bootstrap-combobox.min.js \
	pkg/base1/bundle.min.js \
	pkg/base1/cockpit.min.js \
	pkg/base1/cockpit.min.css \
	pkg/base1/d3.min.js \
	pkg/base1/jquery.min.js \
	pkg/base1/patterns.min.js \
	pkg/base1/moment.min.js \
	pkg/base1/mustache.min.js \
	pkg/base1/require.min.js \
	pkg/base1/term.min.js \
	$(base_GEN) \
	$(base_GEN:.js=.min.js) \
	$(nodist_base_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/base1/angular.min.js \
	pkg/base1/bootstrap-select.min.js \
	pkg/base1/bootstrap-datepicker.min.js \
	pkg/base1/bootstrap-combobox.min.js \
	pkg/base1/bundle.min.js \
	pkg/base1/cockpit.min.css \
	pkg/base1/d3.min.js \
	pkg/base1/jquery.min.js \
	pkg/base1/require.min.js \
	pkg/base1/mustache.min.js \
	pkg/base1/moment.min.js \
	pkg/base1/term.min.js \
	pkg/base1/test-dbus-common.js \
	$(base_BUNDLE) \
	$(base_GEN) \
	$(base_GEN:.js=.min.js) \
	$(NULL)

update-lib:: update-bower
	sed -f $(srcdir)/tools/patternfly.sed \
		$(BOWER)/patternfly/dist/css/patternfly.css > $(srcdir)/pkg/base1/patternfly.css
	sed -f $(srcdir)/tools/patternfly.sed \
		$(BOWER)/patternfly/dist/css/patternfly-additions.css > $(srcdir)/pkg/base1/patternfly-additions.css
	sed -f $(srcdir)/tools/patternfly.sed \
		$(BOWER)/angular-patternfly/dist/styles/angular-patternfly.css > $(srcdir)/pkg/base1/angular-patternfly.css
	$(JSMODULE) -o $(srcdir)/pkg/base1/jquery.js \
	    $(BOWER)/jquery/dist/jquery.js \
	    $(BOWER)/patternfly/components/bootstrap/dist/js/bootstrap.js \
	    $(BOWER)/patternfly/dist/js/patternfly.js \
	    $(BOWER)/jquery-flot/jquery.flot.js \
	    $(BOWER)/jquery-flot/jquery.flot.selection.js \
	    $(BOWER)/jquery-flot/jquery.flot.time.js \
	    $(BOWER)/jquery-amend/jquery-amend.js \
	    $(NULL)
	$(JSMODULE) -m -d jquery -o $(srcdir)/pkg/base1/bootstrap-datepicker.js \
	    $(BOWER)/patternfly/components/bootstrap-datepicker/dist/js/bootstrap-datepicker.js
	$(JSMODULE) -m -d jquery -o $(srcdir)/pkg/base1/bootstrap-combobox.js \
	    $(BOWER)/patternfly/components/bootstrap-combobox/js/bootstrap-combobox.js
	$(JSMODULE) -o $(srcdir)/pkg/base1/require.js \
	    $(BOWER)/requirejs/require.js \
	    $(srcdir)/pkg/base1/require-config.js \
	    $(srcdir)/pkg/base1/require-loaders.js
	$(JSMODULE) -o $(srcdir)/pkg/base1/angular.js \
	    $(BOWER)/angular/angular.js \
	    $(BOWER)/angular-route/angular-route.js \
	    $(BOWER)/angular-animate/angular-animate.js \
	    $(BOWER)/angular-bootstrap/ui-bootstrap.js \
	    $(BOWER)/angular-bootstrap/ui-bootstrap-tpls.js \
	    $(BOWER)/angular-patternfly/dist/angular-patternfly.js \
	    $(srcdir)/pkg/base1/angular-config.js
