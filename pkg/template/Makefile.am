PACKAGE_NAMEdir = $(pkgdatadir)/PACKAGE_NAME
nodist_PACKAGE_NAME_DATA = \
	pkg/PACKAGE_NAME/bundle.min.js.gz \
	pkg/PACKAGE_NAME/index.min.html.gz \
	pkg/PACKAGE_NAME/PACKAGE_NAME.min.css.gz \
	$(NULL)
PACKAGE_NAME_DATA = \
	pkg/PACKAGE_NAME/manifest.json \
	$(NULL)

PACKAGE_NAMEdebugdir = $(debugdir)$(PACKAGE_NAMEdir)
PACKAGE_NAMEdebug_DATA = \
	pkg/PACKAGE_NAME/bundle.js \
	pkg/PACKAGE_NAME/index.html \
	pkg/PACKAGE_NAME/PACKAGE_NAME.js \
	pkg/PACKAGE_NAME/PACKAGE_NAME.css \
	$(NULL)

PACKAGE_NAME_BUNDLE = \
	pkg/PACKAGE_NAME/PACKAGE_NAME.min.js \
	$(NULL)

pkg/PACKAGE_NAME/bundle.min.js: $(PACKAGE_NAME_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

PACKAGE_NAMEimagesdir = $(pkgdatadir)/PACKAGE_NAME/images
PACKAGE_NAMEimages_DATA = \
	$(NULL)

PACKAGE_NAME_TESTS = \
	pkg/PACKAGE_NAME/test.html \
	$(NULL)

TESTS += $(PACKAGE_NAME_TESTS)

CLEANFILES += \
	pkg/PACKAGE_NAME/bundle.min.js \
	pkg/PACKAGE_NAME/index.min.html \
	pkg/PACKAGE_NAME/PACKAGE_NAME.min.css \
	$(PACKAGE_NAME_BUNDLE) \
	$(nodist_PACKAGE_NAME_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/PACKAGE_NAME/bundle.min.js \
	pkg/PACKAGE_NAME/index.min.html \
	pkg/PACKAGE_NAME/PACKAGE_NAME.min.css \
	$(PACKAGE_NAME_DATA) \
	$(PACKAGE_NAMEdebug_DATA) \
	$(PACKAGE_NAMEimages_DATA) \
	$(PACKAGE_NAME_TESTS) \
	$(PACKAGE_NAME_BUNDLE) \
	$(NULL)
