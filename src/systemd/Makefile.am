# -----------------------------------------------------------------------------
# all systemd units, users, tmpfiles, and related helpers

nodist_systemdunit_DATA = \
	src/systemd/cockpit-motd.service \
	src/systemd/cockpit.service \
	src/systemd/cockpit.socket \
	src/systemd/cockpit-wsinstance-http.service \
	src/systemd/cockpit-wsinstance-http.socket \
	src/systemd/cockpit-wsinstance-https-factory@.service \
	src/systemd/cockpit-wsinstance-https-factory.socket \
	src/systemd/cockpit-wsinstance-https@.service \
	src/systemd/cockpit-wsinstance-https@.socket \
	$(NULL)

dist_systemdunit_DATA = \
	src/systemd/system-cockpithttps.slice \
	$(NULL)

motddir = $(datadir)/$(PACKAGE)/motd/
dist_motd_DATA = src/systemd/inactive.motd
dist_motd_SCRIPTS = src/systemd/update-motd

# Automake: 'Variables using ... ‘sysconf’ ... are installed by install-exec.'
install-exec-hook::
	mkdir -p $(DESTDIR)$(sysconfdir)/motd.d
	ln -sTfr $(DESTDIR)/run/cockpit/motd $(DESTDIR)$(sysconfdir)/motd.d/cockpit
	mkdir -p $(DESTDIR)$(sysconfdir)/issue.d
	ln -sTfr $(DESTDIR)/run/cockpit/motd $(DESTDIR)$(sysconfdir)/issue.d/cockpit.issue

tempconfdir = $(prefix)/lib/tmpfiles.d
nodist_tempconf_DATA = src/systemd/cockpit-tempfiles.conf

sysusersdir = $(prefix)/lib/sysusers.d
nodist_sysusers_DATA = src/systemd/sysusers/cockpit.conf

# we can't generate these with config.status because,
# eg. it does "@libexecdir@" -> "${exec_prefix}/libexec"
src/systemd/%: src/systemd/%.in
	$(AM_V_GEN) mkdir -p $(dir $@) && sed \
	-e 's,[@]PACKAGE[@],$(PACKAGE),g' \
	-e 's,[@]admin_group[@],$(admin_group),g' \
	-e 's,[@]datadir[@],$(datadir),g' \
	-e 's,[@]group[@],$(COCKPIT_GROUP),g' \
	-e 's,[@]libexecdir[@],$(libexecdir),g' \
	-e 's,[@]user[@],$(COCKPIT_USER),g' \
	-e 's,[@]wsinstancegroup[@],$(COCKPIT_WSINSTANCE_GROUP),g' \
	-e 's,[@]wsinstanceuser[@],$(COCKPIT_WSINSTANCE_USER),g' \
	$< > $@.tmp && mv -f $@.tmp $@

systemdgenerated = \
	$(nodist_systemdunit_DATA) \
	$(nodist_tempconf_DATA) \
	$(nodist_sysusers_DATA) \
	$(NULL)
systemdgenerated_in = $(patsubst %,%.in,$(systemdgenerated))

EXTRA_DIST += $(systemdgenerated_in)
CLEANFILES += $(systemdgenerated)
