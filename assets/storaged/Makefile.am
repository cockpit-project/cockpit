storageddir = $(pkgdatadir)/storage
nodist_storaged_DATA = \
	assets/storaged/bundle.min.js.gz \
	assets/storaged/index.min.html.gz \
	assets/storaged/storage.min.css.gz \
	$(NULL)
storaged_DATA = \
	assets/storaged/manifest.json \
	$(NULL)

storageddebugdir = $(debugdir)$(storageddir)
storageddebug_DATA = \
	assets/storaged/bundle.js \
	assets/storaged/details.js \
	assets/storaged/devices.js \
	assets/storaged/dialog.js \
	assets/storaged/client.js \
	assets/storaged/index.html \
	assets/storaged/jobs.js \
	assets/storaged/overview.js \
	assets/storaged/permissions.js \
	assets/storaged/storage.css \
	assets/storaged/utils.js \
	$(NULL)

storaged_BUNDLE = \
	assets/storaged/details.min.js \
	assets/storaged/devices.min.js \
	assets/storaged/dialog.min.js \
	assets/storaged/client.min.js \
	assets/storaged/jobs.min.js \
	assets/storaged/overview.min.js \
	assets/storaged/permissions.min.js \
	assets/storaged/utils.min.js \
	$(NULL)

assets/storaged/bundle.min.js: $(storaged_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

storagedimagesdir = $(pkgdatadir)/storage/images
storagedimages_DATA = \
	assets/storaged/images/storage-disk.png \
	assets/storaged/images/storage-array.png \
	$(NULL)

storaged_TESTS = \
	assets/storaged/test-util.html \
	$(NULL)

TESTS += $(storaged_TESTS)

CLEANFILES += \
	assets/storaged/bundle.min.js \
	assets/storaged/index.min.html \
	assets/storaged/storage.min.css \
	$(storaged_BUNDLE) \
	$(nodist_storaged_DATA) \
	$(NULL)

EXTRA_DIST += \
	assets/storaged/bundle.min.js \
	assets/storaged/index.min.html \
	assets/storaged/storage.min.css \
	$(storaged_DATA) \
	$(storageddebug_DATA) \
	$(storagedimages_DATA) \
	$(storaged_TESTS) \
	$(storaged_BUNDLE) \
	$(NULL)
