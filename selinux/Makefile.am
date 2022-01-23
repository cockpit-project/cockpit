SELINUX_POLICY_FILES = \
	selinux/cockpit.fc \
	selinux/cockpit.if \
	selinux/cockpit.te \
	$(NULL)

SELINUX_POLICY_MANPAGES = \
	selinux/cockpit_session_selinux.8cockpit \
	selinux/cockpit_ws_selinux.8cockpit \
	$(NULL)

EXTRA_DIST += \
	$(SELINUX_POLICY_FILES) \
	$(SELINUX_POLICY_MANPAGES) \
	$(NULL)

cockpit.pp: $(SELINUX_POLICY_FILES)
	$(AM_V_GEN) make -sf /usr/share/selinux/devel/Makefile cockpit.pp

cockpit.pp.bz2: cockpit.pp
	$(AM_V_GEN) bzip2 -9 < $< > $@.tmp && mv $@.tmp $@

selinuxpackagesdir = $(datadir)/selinux/packages/$(SELINUX_POLICY_TYPE)/
selinuxactivedir = $(sharedstatedir)/selinux/$(SELINUX_POLICY_TYPE)/active/modules/200/cockpit

install-data-hook::
if SELINUX_POLICY_ENABLED
	$(INSTALL) -d -m 700 $(DESTDIR)$(selinuxactivedir)

selinuxpackages_DATA = cockpit.pp.bz2
man_MANS += $(SELINUX_POLICY_MANPAGES)
endif
