tuneddir = $(pkgdatadir)/tuned
nodist_tuned_DATA = \
	pkg/tuned/bundle.min.js.gz \
	$(NULL)
tuned_DATA = \
	pkg/tuned/manifest.json \
	$(NULL)

tuneddebugdir = $(debugdir)$(tuneddir)
tuneddebug_DATA = \
	pkg/tuned/bundle.js \
	pkg/tuned/dialog.js \
	pkg/tuned/button.html \
	pkg/tuned/dialog.html \
	$(NULL)

tuned_BUNDLE = \
	pkg/tuned/dialog.min.js \
	pkg/tuned/button.html \
	pkg/tuned/dialog.html \
	$(NULL)

pkg/tuned/bundle.min.js: $(tuned_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

tuned_TESTS = \
	$(NULL)

TESTS += $(tuned_TESTS)

CLEANFILES += \
	pkg/tuned/bundle.min.js \
	pkg/tuned/dialog.min.js \
	$(nodist_tuned_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/tuned/bundle.min.js \
	$(tuned_BUNDLE) \
	$(NULL)
