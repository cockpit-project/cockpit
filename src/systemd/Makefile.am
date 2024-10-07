# -----------------------------------------------------------------------------
# all systemd units, tmpfiles, and related helpers

systemdgenerated = $(NULL)
systemdgenerated_in = $(patsubst %,%.in,$(systemdgenerated))
EXTRA_DIST += $(systemdgenerated_in)
CLEANFILES += $(systemdgenerated)

# we can't generate these with config.status because,
# eg. it does "@libexecdir@" -> "${exec_prefix}/libexec"
src/systemd/%: src/systemd/%.in
	$(AM_V_GEN) mkdir -p $(dir $@) && sed \
	-e 's,[@]PACKAGE[@],$(PACKAGE),g' \
	-e 's,[@]admin_group[@],$(admin_group),g' \
	-e 's,[@]datadir[@],$(datadir),g' \
	-e 's,[@]libexecdir[@],$(libexecdir),g' \
	$< > $@.tmp && mv -f $@.tmp $@

# -----------------
# unit files
systemdgenerated += $(nodist_systemdunit_DATA)
nodist_systemdunit_DATA = \
	src/systemd/cockpit-motd.service \
	src/systemd/cockpit.service \
	src/systemd/cockpit.socket \
	src/systemd/cockpit-session@.service \
	src/systemd/cockpit-wsinstance-http.service \
	src/systemd/cockpit-wsinstance-https-factory@.service \
	src/systemd/cockpit-wsinstance-https@.service \
	$(NULL)

dist_systemdunit_DATA = \
	src/systemd/cockpit-session.socket \
	src/systemd/cockpit-ws-user.service \
	src/systemd/system-cockpithttps.slice \
	src/systemd/cockpit-wsinstance-http.socket \
	src/systemd/cockpit-wsinstance-https-factory.socket \
	src/systemd/cockpit-wsinstance-https@.socket \
	$(NULL)

# -----------------
# motd
motddir = $(datadir)/$(PACKAGE)/motd/
dist_motd_DATA = src/systemd/inactive.motd
dist_motd_SCRIPTS = src/systemd/update-motd

# Automake: 'Variables using ... ‘sysconf’ ... are installed by install-exec.'
install-exec-hook::
	mkdir -p $(DESTDIR)$(sysconfdir)/motd.d
	ln -sTfr $(DESTDIR)/run/cockpit/motd $(DESTDIR)$(sysconfdir)/motd.d/cockpit
	mkdir -p $(DESTDIR)$(sysconfdir)/issue.d
	ln -sTfr $(DESTDIR)/run/cockpit/motd $(DESTDIR)$(sysconfdir)/issue.d/cockpit.issue

# -----------------
# tmpfiles
tmpfilesconfdir = $(prefix)/lib/tmpfiles.d
systemdgenerated += $(nodist_tmpfilesconf_DATA)
nodist_tmpfilesconf_DATA = src/systemd/tmpfiles.d/cockpit-ws.conf

# -----------------
# sysusers
sysusersconfdir = $(prefix)/lib/sysusers.d
dist_sysusersconf_DATA = src/systemd/sysusers.d/cockpit-wsinstance.conf

