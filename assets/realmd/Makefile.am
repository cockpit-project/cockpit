realmddir = $(pkgdatadir)/domain
nodist_realmd_DATA = \
	assets/realmd/bundle.min.js.gz \
	$(NULL)
realmd_DATA = \
	assets/realmd/manifest.json \
	$(NULL)

realmddebugdir = $(debugdir)$(realmddir)
realmddebug_DATA = \
	assets/realmd/bundle.js \
	assets/realmd/operation.js \
	assets/realmd/operation.html \
	$(NULL)

realmd_BUNDLE = \
	assets/realmd/operation.min.js \
	assets/realmd/operation.html \
	$(NULL)

assets/realmd/bundle.min.js: $(realmd_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

realmd_TESTS = \
	$(NULL)

TESTS += $(realmd_TESTS)

CLEANFILES += \
	assets/realmd/bundle.min.js \
	assets/realmd/operation.min.js \
	$(nodist_realmd_DATA) \
	$(NULL)

EXTRA_DIST += \
	assets/realmd/bundle.min.js \
	$(realmd_DATA) \
	$(realmddebug_DATA) \
	$(realmd_TESTS) \
	$(realmd_BUNDLE) \
	$(NULL)
