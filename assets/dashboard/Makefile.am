
dashboarddir = $(pkgdatadir)/dashboard
nodist_dashboard_DATA = \
	assets/dashboard/bundle.min.js.gz \
	assets/dashboard/index.min.html.gz \
	$(NULL)
dashboard_DATA = \
	assets/dashboard/manifest.json \
	$(NULL)

dashboarddebugdir = $(debugdir)$(dashboarddir)
dashboarddebug_DATA = \
	assets/dashboard/bundle.js \
	assets/dashboard/list.js \
	assets/dashboard/image-editor.js \
	assets/dashboard/index.html \
	$(NULL)

dashboard_BUNDLE = \
	assets/dashboard/list.min.js \
	assets/dashboard/image-editor.min.js \
	$(NULL)

assets/dashboard/bundle.min.js: $(dashboard_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

CLEANFILES += \
	assets/dashboard/bundle.min.js \
	assets/dashboard/index.min.html \
	$(dashboard_BUNDLE) \
	$(nodist_dashboard_DATA) \
	$(NULL)

EXTRA_DIST += \
	assets/dashboard/bundle.min.js \
	assets/dashboard/index.min.html \
	$(dashboard_DATA) \
	$(dashboarddebug_DATA) \
	$(dashboard_BUNDLE) \
	$(NULL)
	$(NULL)
