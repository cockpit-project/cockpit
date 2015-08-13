networkmanagerdir = $(pkgdatadir)/network
networkmanager_GZ = \
	pkg/networkmanager/bundle.min.js.gz \
	pkg/networkmanager/interfaces.min.html.gz \
	pkg/networkmanager/networking.min.css.gz \
	$(NULL)
networkmanager_DATA = \
	pkg/networkmanager/manifest.json \
	$(networkmanager_GZ) \
	$(NULL)

networkmanagerdebugdir = $(debugdir)$(networkmanagerdir)
networkmanagerdebug_DATA = \
	pkg/networkmanager/bundle.js \
	pkg/networkmanager/interfaces.js \
	pkg/networkmanager/interfaces.html \
	pkg/networkmanager/networking.css \
	$(NULL)

networkmanager_BUNDLE = \
	pkg/networkmanager/interfaces.min.js \
	$(NULL)

pkg/networkmanager/bundle.min.js: $(networkmanager_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

networkmanager_TESTS = \
	$(NULL)

TESTS += $(networkmanager_TESTS)

CLEANFILES += \
	pkg/networkmanager/bundle.min.js \
	pkg/networkmanager/interfaces.min.html \
	$(networkmanager_BUNDLE) \
	$(networkmanager_GZ) \
	$(NULL)

EXTRA_DIST += \
	pkg/networkmanager/bundle.min.js \
	pkg/networkmanager/interfaces.min.html \
	$(networkmanager_DATA) \
	$(networkmanagerdebug_DATA) \
	$(networkmanager_TESTS) \
	$(networkmanager_BUNDLE) \
	$(NULL)
