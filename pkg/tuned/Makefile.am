tuneddir = $(pkgdatadir)/tuned
nodist_tuned_DATA = \
	pkg/tuned/bundle.min.js.gz \
	$(NULL)
tuned_DATA = \
	pkg/tuned/manifest.json \
	$(NULL)

tuneddebugdir = $(debugdir)$(tuneddir)
tuneddebug_DATA = \
	pkg/tuned/react.js \
	pkg/tuned/bundle.js \
	pkg/tuned/dialog.js \
	pkg/tuned/mustache.js \
	pkg/tuned/change-profile.js \
	pkg/tuned/change-profile.jsx \
	pkg/tuned/button.html \
	pkg/tuned/cockpit-components-dialog.js \
	$(NULL)

tuned_BUNDLE = \
	pkg/tuned/dialog.min.js \
	pkg/tuned/mustache.min.js \
	pkg/tuned/react.min.js \
	pkg/tuned/cockpit-components-dialog.min.js \
	pkg/tuned/change-profile.min.js \
	pkg/tuned/button.html \
	$(NULL)

pkg/tuned/bundle.min.js: $(tuned_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

# Ugliness to be solved by webpack in the future
pkg/tuned/react.min.js: pkg/tuned/react.js
	$(MIN_JS_RULE)
pkg/tuned/mustache.min.js: pkg/tuned/mustache.js
	$(MIN_JS_RULE)

tuned_TESTS = \
	$(NULL)

TESTS += $(tuned_TESTS)

CLEANFILES += \
	pkg/tuned/bundle.min.js \
	pkg/tuned/dialog.min.js \
	pkg/tuned/change-profile.min.js \
	pkg/tuned/cockpit-components-dialog.min.js \
	pkg/tuned/cockpit-components-dialog.js \
	pkg/tuned/react.min.js \
	$(nodist_tuned_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/tuned/react.js \
	pkg/tuned/react.min.js \
	pkg/tuned/cockpit-components-dialog.jsx \
	pkg/tuned/cockpit-components-dialog.min.js \
	pkg/tuned/cockpit-components-dialog.js \
	pkg/tuned/bundle.min.js \
	$(tuneddebug_DATA) \
	$(tuned_BUNDLE) \
	$(NULL)
