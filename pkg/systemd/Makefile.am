systemddir = $(pkgdatadir)/system
nodist_systemd_DATA = \
	pkg/systemd/bundle.min.js.gz \
	pkg/systemd/host.min.css.gz \
	pkg/systemd/index.min.html.gz \
	pkg/systemd/journal.min.css.gz \
	pkg/systemd/logs.min.html.gz \
	pkg/systemd/services.min.html.gz \
	pkg/systemd/terminal.min.html.gz \
	$(NULL)
systemd_DATA = \
	pkg/systemd/manifest.json \
	$(NULL)

systemd_SCRIPTS = \
	pkg/systemd/ssh-list-host-keys.sh \
	$(NULL)

systemddebugdir = $(debugdir)$(systemddir)
systemddebug_DATA = \
	pkg/systemd/react.js \
	pkg/systemd/bootstrap-datepicker.js \
	pkg/systemd/bootstrap-combobox.js \
	pkg/systemd/cockpit-components-terminal.js \
	pkg/systemd/flot.js \
	pkg/systemd/host.css \
	pkg/systemd/host.js \
	pkg/systemd/index.html \
	pkg/systemd/mustache.js \
	pkg/systemd/patterns.js \
	pkg/systemd/plot.css \
	pkg/systemd/plot.js \
	pkg/systemd/bundle.js \
	pkg/systemd/init.js \
	pkg/systemd/moment.js \
	pkg/systemd/services.html \
	pkg/systemd/server.js \
	pkg/systemd/service.js \
	pkg/systemd/term.css \
	pkg/systemd/term.js \
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
	$(systemd_SCRIPTS) \
	$(NULL)

systemd_MIN = \
	pkg/systemd/bootstrap-datepicker.min.js \
	pkg/systemd/bootstrap-combobox.min.js \
	pkg/systemd/flot.min.js \
	pkg/systemd/host.min.js \
	pkg/systemd/init.min.js \
	pkg/systemd/mustache.min.js \
	pkg/systemd/patterns.min.js \
	pkg/systemd/plot.min.js \
	pkg/systemd/moment.min.js \
	pkg/systemd/server.min.js \
	pkg/systemd/term.min.js \
	pkg/systemd/terminal.min.js \
	pkg/systemd/journal.min.js \
	pkg/systemd/journalctl.min.js \
	pkg/systemd/renderer.min.js \
	pkg/systemd/service.min.js \
	$(NULL)
systemd_BUNDLE = \
	pkg/systemd/react.min.js \
	pkg/systemd/cockpit-components-terminal.min.js \
	pkg/systemd/journal_day_header.mustache \
	pkg/systemd/journal_line.mustache \
	pkg/systemd/journal_reboot.mustache \
	$(systemd_SCRIPTS) \
	$(systemd_MIN) \
	$(NULL)

pkg/systemd/bundle.min.js: $(systemd_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

# Ugliness to be solved by webpack in the future
pkg/systemd/flot.min.js: pkg/systemd/flot.js
	$(MIN_JS_RULE)
pkg/systemd/mustache.min.js: pkg/systemd/mustache.js
	$(MIN_JS_RULE)
pkg/systemd/react.min.js: pkg/systemd/react.js
	$(MIN_JS_RULE)
pkg/systemd/term.min.js: pkg/systemd/term.js
	$(MIN_JS_RULE)
pkg/systemd/moment.min.js: pkg/systemd/moment.js
	$(MIN_JS_RULE)

systemd_TESTS = \
	pkg/systemd/test-journal-renderer.html \
	$(NULL)

TESTS += $(systemd_TESTS)

CLEANFILES += \
	pkg/systemd/bootstrap-datepicker.min.js \
	pkg/systemd/bootstrap-combobox.min.js \
	pkg/systemd/cockpit-components-terminal.min.js \
	pkg/systemd/cockpit-components-terminal.js \
	pkg/systemd/bundle.min.js \
	pkg/systemd/host.min.css \
	pkg/systemd/index.min.html \
	pkg/systemd/journal.min.css \
	pkg/systemd/logs.min.html \
	pkg/systemd/plot.min.css \
	pkg/systemd/react.min.js \
	pkg/systemd/services.min.html \
	pkg/systemd/terminal.min.html \
	pkg/systemd/terminal.js \
	$(systemd_MIN) \
	$(nodist_systemd_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/systemd/react.js \
	pkg/systemd/react.min.js \
	pkg/systemd/cockpit-components-terminal.jsx \
	pkg/systemd/cockpit-components-terminal.min.js \
	pkg/systemd/cockpit-components-terminal.js \
	pkg/systemd/bootstrap-combobox.min.js \
	pkg/systemd/bootstrap-datepicker.min.js \
	pkg/systemd/bundle.min.js \
	pkg/systemd/host.min.css \
	pkg/systemd/index.min.html \
	pkg/systemd/journal.min.css \
	pkg/systemd/logs.min.html \
	pkg/systemd/plot.min.css \
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
