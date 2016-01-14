storageddir = $(pkgdatadir)/storage
nodist_storaged_DATA = \
	pkg/storaged/bundle.min.js.gz \
	pkg/storaged/index.min.html.gz \
	pkg/storaged/storage.min.css.gz \
	$(NULL)
storaged_DATA = \
	pkg/storaged/manifest.json \
	$(NULL)

storageddebugdir = $(debugdir)$(storageddir)
storageddebug_DATA = \
	pkg/storaged/bundle.js \
	pkg/storaged/details.js \
	pkg/storaged/devices.js \
	pkg/storaged/dialog.js \
	pkg/storaged/client.js \
	pkg/storaged/index.html \
	pkg/storaged/jobs.js \
	pkg/storaged/overview.js \
	pkg/storaged/permissions.js \
	pkg/storaged/storage.css \
	pkg/storaged/utils.js \
	$(NULL)

storaged_BUNDLE = \
	pkg/storaged/details.min.js \
	pkg/storaged/devices.min.js \
	pkg/storaged/dialog.min.js \
	pkg/storaged/client.min.js \
	pkg/storaged/jobs.min.js \
	pkg/storaged/overview.min.js \
	pkg/storaged/permissions.min.js \
	pkg/storaged/utils.min.js \
	$(NULL)

pkg/storaged/bundle.min.js: $(storaged_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

storagedimagesdir = $(pkgdatadir)/storage/images
storagedimages_DATA = \
	pkg/storaged/images/storage-disk.png \
	pkg/storaged/images/storage-array.png \
	$(NULL)

storaged_TESTS = \
	pkg/storaged/test-util.html \
	$(NULL)

TESTS += $(storaged_TESTS)

CLEANFILES += \
	pkg/storaged/bundle.min.js \
	pkg/storaged/index.min.html \
	pkg/storaged/storage.min.css \
	$(storaged_BUNDLE) \
	$(nodist_storaged_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/storaged/bundle.min.js \
	pkg/storaged/index.min.html \
	pkg/storaged/storage.min.css \
	$(storaged_BUNDLE) \
	$(NULL)
