storageddir = $(pkgdatadir)/storage
storaged_DATA = \
	pkg/storaged/bundle.min.js.gz \
	pkg/storaged/devices.min.html.gz \
	pkg/storaged/manifest.json \
	pkg/storaged/storage.min.css.gz \
	$(NULL)

storageddebugdir = $(DBGDIR)$(storageddir)
storageddebug_DATA = \
	pkg/storaged/bundle.js \
	pkg/storaged/details.js \
	pkg/storaged/devices.html \
	pkg/storaged/devices.js \
	pkg/storaged/dialog.js \
	pkg/storaged/client.js \
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
	$(NULL)

storaged_TESTS = \
	$(NULL)

TESTS += $(storaged_TESTS)

CLEANFILES += \
	pkg/storaged/bundle.min.js \
	pkg/storaged/devices.min.html \
	$(storaged_BUNDLE) \
	$(NULL)

EXTRA_DIST += \
	pkg/storaged/bundle.min.js \
	pkg/storaged/devices.min.html \
	$(storaged_DATA) \
	$(storageddebug_DATA) \
	$(storagedimages_DATA) \
	$(storaged_TESTS) \
	$(storaged_BUNDLE) \
	$(NULL)
