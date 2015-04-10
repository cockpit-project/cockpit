systemddir = $(pkgdatadir)/system
systemd_DATA = \
	pkg/systemd/bundle.min.js.gz \
	pkg/systemd/init.min.html.gz \
	pkg/systemd/log.min.html.gz \
	pkg/systemd/manifest.json \
	pkg/systemd/terminal.min.html.gz \
	$(NULL)

systemddebugdir = $(DBGDIR)$(systemddir)
systemddebug_DATA = \
	pkg/systemd/bundle.js \
	pkg/systemd/init.js \
	pkg/systemd/init.html \
	pkg/systemd/log.html \
	pkg/systemd/log.js \
	pkg/systemd/server.js \
	pkg/systemd/terminal.js \
	pkg/systemd/terminal.html \
	$(NULL)

systemd_BUNDLE = \
	pkg/systemd/init.min.js \
	pkg/systemd/log.min.js \
	pkg/systemd/server.min.js \
	pkg/systemd/terminal.min.js \
	$(NULL)

pkg/systemd/bundle.min.js: $(systemd_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

systemd_TESTS = \
	pkg/systemd/test-journal-renderer.html \
	$(NULL)

TESTS += $(systemd_TESTS)

CLEANFILES += \
	pkg/systemd/bundle.min.js \
	pkg/systemd/init.min.html \
	pkg/systemd/log.min.html \
	pkg/systemd/terminal.min.html \
	$(systed_BUNDLE) \
	$(NULL)

EXTRA_DIST += \
	pkg/systemd/bundle.min.js \
	pkg/systemd/init.min.html \
	pkg/systemd/log.min.html \
	pkg/systemd/terminal.min.html \
	$(systemd_DATA) \
	$(systemddebug_DATA) \
	$(systemd_TESTS) \
	$(systemd_BUNDLE) \
	$(NULL)
