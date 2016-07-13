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
	pkg/networkmanager/flot.js \
	pkg/networkmanager/interfaces.js \
	pkg/networkmanager/index.html \
	pkg/networkmanager/journal.css \
	pkg/networkmanager/networking.css \
	pkg/networkmanager/mustache.js \
	pkg/networkmanager/plot.css \
	pkg/networkmanager/plot.js \
	pkg/networkmanager/patterns.js \
	$(NULL)

networkmanager_BUNDLE = \
	pkg/networkmanager/interfaces.min.js \
	pkg/networkmanager/flot.min.js \
	pkg/networkmanager/mustache.min.js \
	pkg/networkmanager/patterns.min.js \
	pkg/networkmanager/plot.min.js \
	$(NULL)

pkg/networkmanager/bundle.min.js: $(networkmanager_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

# Ugliness to be solved by webpack in the future
pkg/networkmanager/flot.min.js: pkg/networkmanager/flot.js
	$(MIN_JS_RULE)
pkg/networkmanager/mustache.min.js: pkg/networkmanager/mustache.js
	$(MIN_JS_RULE)

networkmanager_TESTS = \
	$(NULL)

TESTS += $(networkmanager_TESTS)

CLEANFILES += \
	pkg/networkmanager/bundle.min.js \
	pkg/networkmanager/index.min.html \
	pkg/networkmanager/networking.min.css \
	pkg/networkmanager/patterns.min.js \
	pkg/networkmanager/plot.min.css \
	$(networkmanager_BUNDLE) \
	$(nodist_networkmanager_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/networkmanager/bundle.min.js \
	pkg/networkmanager/index.min.html \
	pkg/networkmanager/networking.min.css \
	pkg/networkmanager/patterns.min.js \
	pkg/networkmanager/plot.min.css \
	$(networkmanager_BUNDLE) \
	$(NULL)
