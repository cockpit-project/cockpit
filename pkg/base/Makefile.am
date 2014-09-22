
basedir = $(pkgdatadir)/base
nodist_base_DATA = \
	pkg/base/cockpit.min.js
base_DATA = \
	pkg/base/cockpit.js \
	pkg/base/jquery.js \
	pkg/base/jquery.min.js \
	pkg/base/bootstrap.js \
	pkg/base/bootstrap.min.js \
	pkg/base/term.js \
	pkg/base/manifest.json \
	$(NULL)

base_TESTS = \
	 pkg/base/test-chan.html \
	 pkg/base/test-spawn.html \
	 $(NULL)

TESTS += $(base_TESTS)

CLEANFILES += \
	pkg/base/cockpit.min.js \
	$(NULL)

EXTRA_DIST += \
	$(base_DATA) \
	$(base_TESTS) \
	$(NULL)
