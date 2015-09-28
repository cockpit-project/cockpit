realmddir = $(pkgdatadir)/domain
nodist_realmd_DATA = \
	pkg/realmd/bundle.min.js.gz \
	$(NULL)
realmd_DATA = \
	pkg/realmd/manifest.json \
	$(NULL)

realmddebugdir = $(debugdir)$(realmddir)
realmddebug_DATA = \
	pkg/realmd/bundle.js \
	pkg/realmd/operation.js \
	pkg/realmd/operation.html \
	$(NULL)

realmd_BUNDLE = \
	pkg/realmd/operation.min.js \
	pkg/realmd/operation.html \
	$(NULL)

pkg/realmd/bundle.min.js: $(realmd_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

realmd_TESTS = \
	$(NULL)

TESTS += $(realmd_TESTS)

CLEANFILES += \
	pkg/realmd/bundle.min.js \
	pkg/realmd/operation.min.js \
	$(nodist_realmd_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/realmd/bundle.min.js \
	$(realmd_DATA) \
	$(realmddebug_DATA) \
	$(realmd_TESTS) \
	$(realmd_BUNDLE) \
	$(NULL)
