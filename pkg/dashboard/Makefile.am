
dashboarddir = $(pkgdatadir)/dashboard
nodist_dashboard_DATA = \
	pkg/dashboard/bundle.min.js.gz \
	pkg/dashboard/index.min.html.gz \
	$(NULL)
dashboard_DATA = \
	pkg/dashboard/manifest.json \
	$(NULL)

dashboarddebugdir = $(debugdir)$(dashboarddir)
dashboarddebug_DATA = \
	pkg/dashboard/bundle.js \
	pkg/dashboard/flot.js \
	pkg/dashboard/list.js \
	pkg/dashboard/image-editor.js \
	pkg/dashboard/index.html \
	pkg/dashboard/mustache.js \
	pkg/dashboard/patterns.js \
	pkg/dashboard/plot.js \
	$(NULL)

dashboard_BUNDLE = \
	pkg/dashboard/flot.min.js \
	pkg/dashboard/list.min.js \
	pkg/dashboard/image-editor.min.js \
	pkg/dashboard/patterns.min.js \
	pkg/dashboard/plot.min.js \
	pkg/dashboard/mustache.min.js \
	$(NULL)

pkg/dashboard/bundle.min.js: $(dashboard_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

# Ugliness to be solved by webpack in the future
pkg/dashboard/flot.min.js: pkg/dashboard/flot.js
	$(MIN_JS_RULE)
pkg/dashboard/mustache.min.js: pkg/dashboard/mustache.js
	$(MIN_JS_RULE)

CLEANFILES += \
	pkg/dashboard/bundle.min.js \
	pkg/dashboard/index.min.html \
	$(dashboard_BUNDLE) \
	$(nodist_dashboard_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/dashboard/bundle.min.js \
	pkg/dashboard/index.min.html \
	$(dashboard_BUNDLE) \
	$(NULL)
