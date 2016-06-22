playgrounddir = $(pkgdatadir)/playground
playground_DATA = \
	pkg/playground/react.js \
	pkg/playground/cockpit-components-listing.js \
	pkg/playground/cockpit-components-select.js \
	pkg/playground/cockpit-components-dialog.js \
	pkg/playground/test.html \
	pkg/playground/test.min.html \
	pkg/playground/test.js \
	pkg/playground/speed.html \
	pkg/playground/speed.min.html \
	pkg/playground/metrics.html \
	pkg/playground/metrics.min.html \
	pkg/playground/patterns.js \
	pkg/playground/jquery-patterns.html \
	pkg/playground/jquery-patterns.js \
	pkg/playground/react-patterns.html \
	pkg/playground/react-patterns.js \
	pkg/playground/react-demo-dialog.js \
	pkg/playground/react-demo-listing.js \
	pkg/playground/service.html \
	pkg/playground/service.min.html \
	pkg/playground/service.js \
	pkg/playground/plot.html \
	pkg/playground/plot.min.html \
	pkg/playground/plot.js \
	pkg/playground/flot.js \
	pkg/playground/manifest.json \
	pkg/playground/hammer.gif \
	pkg/playground/po.de.js \
	pkg/playground/po.js \
	$(NULL)

playground_NOINST = \
	pkg/playground/test.min.js \
	pkg/playground/patterns.min.js \
	pkg/playground/jquery-patterns.min.js \
	pkg/playground/react-patterns.min.js \
	pkg/playground/react-demo-dialog.min.js \
	pkg/playground/react-demo-listing.min.js \
	pkg/playground/service.min.js \
	$(NULL)

# Ugliness to be solved by webpack in the future
pkg/playground/react.min.js: pkg/playground/react.js
	$(MIN_JS_RULE)

noinst_DATA += $(playground_NOINST)

CLEANFILES += \
	pkg/playground/test.min.html \
	pkg/playground/test.min.js \
	pkg/playground/speed.min.html \
	pkg/playground/metrics.min.html \
	pkg/playground/jquery-patterns.min.html \
	pkg/playground/patterns.min.js \
	pkg/playground/plot.min.html \
	pkg/playground/jquery-patterns.min.js \
	pkg/playground/react-patterns.min.html \
	pkg/playground/react-patterns.min.js \
	pkg/playground/react-demo-dialog.min.js \
	pkg/playground/react-demo-listing.min.js \
	pkg/playground/service.min.html \
	pkg/playground/service.min.js \
	pkg/playground/react.min.js \
	pkg/playground/cockpit-components-listing.js \
	pkg/playground/cockpit-components-select.js \
	pkg/playground/cockpit-components-dialog.js \
	$(NULL)

EXTRA_DIST += \
	pkg/playground/react.js \
	pkg/playground/react.min.js \
	pkg/playground/cockpit-components-listing.jsx \
	pkg/playground/cockpit-components-select.jsx \
	pkg/playground/cockpit-components-dialog.jsx \
	pkg/playground/cockpit-components-listing.js \
	pkg/playground/cockpit-components-select.js \
	pkg/playground/cockpit-components-dialog.js \
	$(playground_DATA) \
	$(playground_NOINST) \
	$(NULL)
