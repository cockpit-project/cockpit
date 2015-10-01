systemddir = $(pkgdatadir)/system
nodist_systemd_DATA = \
	assets/systemd/bundle.min.js.gz \
	assets/systemd/index.min.html.gz \
	assets/systemd/journal.min.css.gz \
	assets/systemd/logs.min.html.gz \
	assets/systemd/service.min.js.gz \
	assets/systemd/services.min.html.gz \
	assets/systemd/terminal.min.html.gz \
	$(NULL)
systemd_DATA = \
	assets/systemd/manifest.json \
	$(NULL)

systemddebugdir = $(debugdir)$(systemddir)
systemddebug_DATA = \
	assets/systemd/host.js \
	assets/systemd/index.html \
	assets/systemd/bundle.js \
	assets/systemd/init.js \
	assets/systemd/services.html \
	assets/systemd/server.js \
	assets/systemd/service.js \
	assets/systemd/terminal.js \
	assets/systemd/terminal.html \
	assets/systemd/logs.html \
	assets/systemd/journal.js \
	assets/systemd/journal.css \
	assets/systemd/journalctl.js \
	assets/systemd/renderer.js \
	assets/systemd/journal_day_header.mustache \
	assets/systemd/journal_line.mustache \
	assets/systemd/journal_reboot.mustache \
	$(NULL)

systemd_MIN = \
	assets/systemd/host.min.js \
	assets/systemd/init.min.js \
	assets/systemd/server.min.js \
	assets/systemd/terminal.min.js \
	assets/systemd/journal.min.js \
	assets/systemd/journalctl.min.js \
	assets/systemd/renderer.min.js \
	$(NULL)
systemd_BUNDLE = \
	assets/systemd/journal_day_header.mustache \
	assets/systemd/journal_line.mustache \
	assets/systemd/journal_reboot.mustache \
	$(systemd_MIN) \
	$(NULL)

assets/systemd/bundle.min.js: $(systemd_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

systemd_TESTS = \
	assets/systemd/test-journal-renderer.html \
	$(NULL)

TESTS += $(systemd_TESTS)

CLEANFILES += \
	assets/systemd/bundle.min.js \
	assets/systemd/index.min.html \
	assets/systemd/journal.min.css \
	assets/systemd/logs.min.html \
	assets/systemd/services.min.html \
	assets/systemd/terminal.min.html \
	$(systemd_MIN) \
	$(nodist_systemd_DATA) \
	$(NULL)

EXTRA_DIST += \
	assets/systemd/bundle.min.js \
	assets/systemd/index.min.html \
	assets/systemd/journal.min.css \
	assets/systemd/logs.min.html \
	assets/systemd/service.min.js \
	assets/systemd/services.min.html \
	assets/systemd/terminal.min.html \
	$(systemd_DATA) \
	$(systemddebug_DATA) \
	$(systemd_TESTS) \
	$(systemd_BUNDLE) \
	$(NULL)
