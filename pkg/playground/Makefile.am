playgrounddir = $(pkgdatadir)/playground
playground_DATA = \
	pkg/playground/test.html \
	pkg/playground/test.min.html \
	pkg/playground/test.js \
	pkg/playground/speed.html \
	pkg/playground/speed.min.html \
	pkg/playground/metrics.html \
	pkg/playground/metrics.min.html \
	pkg/playground/patterns.html \
	pkg/playground/patterns.js \
	pkg/playground/patterns.min.html \
	pkg/playground/service.html \
	pkg/playground/service.min.html \
	pkg/playground/service.js \
	pkg/playground/plot.html \
	pkg/playground/plot.min.html \
	pkg/playground/manifest.json \
	pkg/playground/hammer.gif \
	pkg/playground/po.de.js \
	pkg/playground/po.en.js \
	$(NULL)

playground_NOINST = \
	pkg/playground/test.min.js \
	pkg/playground/patterns.min.js \
	pkg/playground/service.min.js \
	$(NULL)

noinst_DATA += $(playground_NOINST)

CLEANFILES += \
	pkg/playground/test.min.html \
	pkg/playground/test.min.js \
	pkg/playground/speed.min.html \
	pkg/playground/metrics.min.html \
	pkg/playground/patterns.min.js \
	pkg/playground/plot.min.html \
	pkg/playground/service.min.html \
	pkg/playground/service.min.js \
	pkg/playground/patterns.min.html \
	$(NULL)

EXTRA_DIST += \
	$(playground_DATA) \
	$(playground_NOINST) \
	$(NULL)
