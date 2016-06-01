networkmanagerdir = $(pkgdatadir)/network
nodist_networkmanager_DATA = \
	pkg/networkmanager/bundle.min.js.gz \
	pkg/networkmanager/index.min.html.gz \
	pkg/networkmanager/networking.min.css.gz \
	$(NULL)
networkmanager_DATA = \
	pkg/networkmanager/manifest.json \
	$(NULL)

networkmanagerdebugdir = $(debugdir)$(networkmanagerdir)
networkmanagerdebug_DATA = \
	pkg/networkmanager/bundle.js \
	pkg/networkmanager/interfaces.js \
	pkg/networkmanager/index.html \
	pkg/networkmanager/networking.css \
	pkg/networkmanager/patterns.js \
	$(NULL)

networkmanager_BUNDLE = \
	pkg/networkmanager/interfaces.min.js \
	pkg/networkmanager/patterns.min.js \
	$(NULL)

pkg/networkmanager/bundle.min.js: $(networkmanager_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

networkmanager_TESTS = \
	$(NULL)

TESTS += $(networkmanager_TESTS)

CLEANFILES += \
	pkg/networkmanager/bundle.min.js \
	pkg/networkmanager/index.min.html \
	pkg/networkmanager/networking.min.css \
	pkg/networkmanager/patterns.min.js \
	$(networkmanager_BUNDLE) \
	$(nodist_networkmanager_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/networkmanager/bundle.min.js \
	pkg/networkmanager/index.min.html \
	pkg/networkmanager/networking.min.css \
	pkg/networkmanager/patterns.min.js \
	$(networkmanager_BUNDLE) \
	$(NULL)
