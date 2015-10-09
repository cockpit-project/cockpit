networkmanagerdir = $(pkgdatadir)/network
nodist_networkmanager_DATA = \
	assets/networkmanager/bundle.min.js.gz \
	assets/networkmanager/index.min.html.gz \
	assets/networkmanager/networking.min.css.gz \
	$(NULL)
networkmanager_DATA = \
	assets/networkmanager/manifest.json \
	$(NULL)

networkmanagerdebugdir = $(debugdir)$(networkmanagerdir)
networkmanagerdebug_DATA = \
	assets/networkmanager/bundle.js \
	assets/networkmanager/interfaces.js \
	assets/networkmanager/index.html \
	assets/networkmanager/networking.css \
	$(NULL)

networkmanager_BUNDLE = \
	assets/networkmanager/interfaces.min.js \
	$(NULL)

assets/networkmanager/bundle.min.js: $(networkmanager_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

networkmanager_TESTS = \
	$(NULL)

TESTS += $(networkmanager_TESTS)

CLEANFILES += \
	assets/networkmanager/bundle.min.js \
	assets/networkmanager/index.min.html \
	assets/networkmanager/networking.min.css \
	$(networkmanager_BUNDLE) \
	$(nodist_networkmanager_DATA) \
	$(NULL)

EXTRA_DIST += \
	assets/networkmanager/bundle.min.js \
	assets/networkmanager/index.min.html \
	assets/networkmanager/networking.min.css \
	$(networkmanager_DATA) \
	$(networkmanagerdebug_DATA) \
	$(networkmanager_TESTS) \
	$(networkmanager_BUNDLE) \
	$(NULL)
