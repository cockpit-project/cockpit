
tuneddir = $(pkgdatadir)/tuned
tuned_DATA = \
	pkg/tuned/tuned.min.css.gz \
	pkg/tuned/tuned.min.html.gz \
	pkg/tuned/tuned.min.js.gz \
	pkg/tuned/manifest.json \
	$(NULL)

tuneddebugdir = $(DBGDIR)$(tuneddir)
tuneddebug_DATA = \
	pkg/tuned/tuned.html \
	pkg/tuned/tuned.js \
	pkg/tuned/tuned.css \
	$(NULL)

CLEANFILES += \
	pkg/tuned/tuned.min.js \
	pkg/tuned/tuned.min.html \
	pkg/tuned/tuned.min.css \
	$(NULL)

EXTRA_DIST += \
	pkg/tuned/tuned.min.js \
	pkg/tuned/tuned.min.html \
	pkg/tuned/tuned.min.css \
	$(tuned_DATA) \
	$(tuneddebug_DATA) \
	$(NULL)
