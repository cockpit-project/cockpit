
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
	pkg/dashboard/list.js \
	pkg/dashboard/image-editor.js \
	pkg/dashboard/index.html \
	$(NULL)

dashboard_BUNDLE = \
	pkg/dashboard/list.min.js \
	pkg/dashboard/image-editor.min.js \
	$(NULL)

pkg/dashboard/bundle.min.js: $(dashboard_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

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
