
basedir = $(pkgdatadir)/base
nodist_base_DATA = \
	pkg/base/cockpit.min.js
base_DATA = \
	pkg/base/patternfly.css \
	pkg/base/cockpit.css \
	pkg/base/cockpit.js \
	pkg/base/jquery.js \
	pkg/base/jquery.min.js \
	pkg/base/bootstrap.js \
	pkg/base/bootstrap.min.js \
	pkg/base/term.js \
	pkg/base/manifest.json \
	$(NULL)

baseimagesdir = $(pkgdatadir)/base/images
baseimages_DATA = \
	pkg/base/images/play.png \
	pkg/base/images/eject.png \
	pkg/base/images/stop.png \
	$(NULL)

base_TESTS = \
	pkg/base/test-chan.html \
	pkg/base/test-async.html \
	pkg/base/test-no-jquery.html \
        pkg/base/test-amdjs.html \
	pkg/base/test-spawn.html \
	pkg/base/test-spawn-proc.html \
	pkg/base/test-dbus.html \
	$(NULL)

TESTS += $(base_TESTS)

CLEANFILES += \
	pkg/base/cockpit.min.js \
	$(NULL)

EXTRA_DIST += \
	$(base_DATA) \
	$(base_TESTS) \
	$(baseimages_DATA) \
	$(NULL)
