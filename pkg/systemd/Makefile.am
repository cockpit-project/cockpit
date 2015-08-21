systemddir = $(pkgdatadir)/system
systemd_GZ = \
	pkg/systemd/bundle.min.js.gz \
	pkg/systemd/init.min.html.gz \
	pkg/systemd/terminal.min.html.gz \
	pkg/systemd/journal.min.html.gz \
	pkg/systemd/journal.min.css.gz \
	pkg/systemd/service.min.js.gz \
	$(NULL)
systemd_DATA = \
	pkg/systemd/manifest.json \
	$(systemd_GZ) \
	$(NULL)

systemddebugdir = $(debugdir)$(systemddir)
systemddebug_DATA = \
	pkg/systemd/bundle.js \
	pkg/systemd/init.js \
	pkg/systemd/init.html \
	pkg/systemd/server.js \
	pkg/systemd/service.js \
	pkg/systemd/terminal.js \
	pkg/systemd/terminal.html \
	pkg/systemd/journal.html \
	pkg/systemd/journal.js \
	pkg/systemd/journal.css \
	pkg/systemd/journalctl.js \
	pkg/systemd/renderer.js \
	pkg/systemd/journal_day_header.mustache \
	pkg/systemd/journal_line.mustache \
	pkg/systemd/journal_reboot.mustache \
	$(NULL)

systemd_MIN = \
	pkg/systemd/init.min.js \
	pkg/systemd/server.min.js \
	pkg/systemd/terminal.min.js \
	pkg/systemd/journal.min.js \
	pkg/systemd/journalctl.min.js \
	pkg/systemd/renderer.min.js \
	$(NULL)
systemd_BUNDLE = \
	pkg/systemd/journal_day_header.mustache \
	pkg/systemd/journal_line.mustache \
	pkg/systemd/journal_reboot.mustache \
	$(systemd_MIN) \
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
	pkg/systemd/terminal.min.html \
	pkg/systemd/journal.min.html \
	$(systemd_MIN) \
	$(systemd_GZ) \
	$(NULL)

EXTRA_DIST += \
	pkg/systemd/bundle.min.js \
	pkg/systemd/init.min.html \
	pkg/systemd/terminal.min.html \
	pkg/systemd/journal.min.html \
	$(systemd_DATA) \
	$(systemddebug_DATA) \
	$(systemd_TESTS) \
	$(systemd_BUNDLE) \
	$(NULL)
