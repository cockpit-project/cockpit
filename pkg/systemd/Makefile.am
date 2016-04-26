systemddir = $(pkgdatadir)/system
nodist_systemd_DATA = \
	pkg/systemd/bundle.min.js.gz \
	pkg/systemd/host.min.css.gz \
	pkg/systemd/index.min.html.gz \
	pkg/systemd/journal.min.css.gz \
	pkg/systemd/logs.min.html.gz \
	pkg/systemd/service.min.js.gz \
	pkg/systemd/services.min.html.gz \
	pkg/systemd/terminal.min.html.gz \
	$(NULL)
systemd_DATA = \
	pkg/systemd/manifest.json \
	$(NULL)

systemddebugdir = $(debugdir)$(systemddir)
systemddebug_DATA = \
	pkg/systemd/bootstrap-datepicker.js \
	pkg/systemd/bootstrap-combobox.js \
	pkg/systemd/host.css \
	pkg/systemd/host.js \
	pkg/systemd/index.html \
	pkg/systemd/bundle.js \
	pkg/systemd/init.js \
	pkg/systemd/services.html \
	pkg/systemd/server.js \
	pkg/systemd/service.js \
	pkg/systemd/terminal.js \
	pkg/systemd/terminal.jsx \
	pkg/systemd/terminal.html \
	pkg/systemd/logs.html \
	pkg/systemd/journal.js \
	pkg/systemd/journal.css \
	pkg/systemd/journalctl.js \
	pkg/systemd/renderer.js \
	pkg/systemd/journal_day_header.mustache \
	pkg/systemd/journal_line.mustache \
	pkg/systemd/journal_reboot.mustache \
	$(NULL)

systemd_MIN = \
	pkg/systemd/bootstrap-datepicker.min.js \
	pkg/systemd/bootstrap-combobox.min.js \
	pkg/systemd/host.min.js \
	pkg/systemd/init.min.js \
	pkg/systemd/server.min.js \
	pkg/systemd/terminal.min.js \
	pkg/systemd/journal.min.js \
	pkg/systemd/journalctl.min.js \
	pkg/systemd/renderer.min.js \
	pkg/systemd/service.min.js \
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
	pkg/systemd/bootstrap-datepicker.min.js \
	pkg/systemd/bootstrap-combobox.min.js \
	pkg/systemd/bundle.min.js \
	pkg/systemd/host.min.css \
	pkg/systemd/index.min.html \
	pkg/systemd/journal.min.css \
	pkg/systemd/logs.min.html \
	pkg/systemd/services.min.html \
	pkg/systemd/terminal.min.html \
	pkg/systemd/terminal.js \
	$(systemd_MIN) \
	$(nodist_systemd_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/systemd/bootstrap-combobox.min.js \
	pkg/systemd/bootstrap-datepicker.min.js \
	pkg/systemd/bundle.min.js \
	pkg/systemd/host.min.css \
	pkg/systemd/index.min.html \
	pkg/systemd/journal.min.css \
	pkg/systemd/logs.min.html \
	pkg/systemd/service.min.js \
	pkg/systemd/services.min.html \
	pkg/systemd/terminal.min.html \
	pkg/systemd/terminal.jsx \
	pkg/systemd/terminal.js \
	$(systemd_BUNDLE) \
	$(NULL)

update-lib:: update-bower
	$(JSMODULE) -m -d jquery -o $(srcdir)/pkg/systemd/bootstrap-datepicker.js \
	    $(BOWER)/bootstrap-datepicker/dist/js/bootstrap-datepicker.js
	$(JSMODULE) -m -d jquery -o $(srcdir)/pkg/systemd/bootstrap-combobox.js \
	    $(BOWER)/bootstrap-combobox/js/bootstrap-combobox.js
