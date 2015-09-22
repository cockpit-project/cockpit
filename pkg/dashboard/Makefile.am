
dashboarddir = $(pkgdatadir)/dashboard
dashboard_GZ = \
	pkg/dashboard/bundle.min.js.gz \
	pkg/dashboard/index.min.html.gz \
	$(NULL)
dashboard_DATA = \
	pkg/dashboard/manifest.json \
	$(dashboard_GZ) \
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
	$(networkmanager_BUNDLE) \
	$(networkmanager_GZ) \
	$(NULL)

EXTRA_DIST += \
	pkg/dashboard/bundle.min.js \
	pkg/dashboard/index.min.html \
	$(dashboard_DATA) \
	$(dashboarddebug_DATA) \
	$(dashboard_BUNDLE) \
	$(NULL)
	$(NULL)
