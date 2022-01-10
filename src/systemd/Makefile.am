# all systemd units, tmpfiles, and related helpers

systemd_units_in = \
	src/systemd/cockpit-motd.service.in \
	src/systemd/cockpit.service.in \
	src/systemd/cockpit.socket.in \
	src/systemd/cockpit-wsinstance-http.service.in \
	src/systemd/cockpit-wsinstance-http.socket.in \
	src/systemd/cockpit-wsinstance-https-factory@.service.in \
	src/systemd/cockpit-wsinstance-https-factory.socket.in \
	src/systemd/cockpit-wsinstance-https@.service.in \
	src/systemd/cockpit-wsinstance-https@.socket.in \
	$(NULL)

nodist_systemdunit_DATA += $(patsubst %.in,%,$(systemd_units_in))
dist_systemdunit_DATA += src/systemd/system-cockpithttps.slice

motddir = $(datadir)/$(PACKAGE)/motd/
dist_motd_DATA = src/systemd/inactive.motd
dist_motd_SCRIPTS = src/systemd/update-motd

# Automake: 'Variables using ... ‘sysconf’ ... are installed by install-exec.'
install-exec-hook::
	mkdir -p $(DESTDIR)$(sysconfdir)/motd.d
	ln -snf /run/cockpit/motd $(DESTDIR)$(sysconfdir)/motd.d/cockpit
	mkdir -p $(DESTDIR)$(sysconfdir)/issue.d
	ln -snf /run/cockpit/motd $(DESTDIR)$(sysconfdir)/issue.d/cockpit.issue

tempconfdir = $(prefix)/lib/tmpfiles.d
nodist_tempconf_DATA = src/systemd/cockpit-tempfiles.conf
tempconf_in = src/systemd/cockpit-tempfiles.conf.in

$(nodist_tempconf_DATA): $(tempconf_in)
	$(SUBST_RULE)

EXTRA_DIST += \
	$(systemd_units_in) \
	$(tempconf_in) \
	$(NULL)

CLEANFILES += \
	$(patsubst %.in,%,$(systemd_units_in)) \
	$(nodist_tempconf_DATA) \
	$(NULL)
