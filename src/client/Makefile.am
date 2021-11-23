# We actually always install cockpit-client in libexec,
# but ENABLE_COCKPIT_CLIENT controls whether we install
# cockpit-client-ssh.
# This is currently **EXPERIMENTAL**

cockpitclientdir = $(libexecdir)
dist_cockpitclient_SCRIPTS = \
	src/client/cockpit-client \
	$(NULL)

dist_cockpitclient_DATA = \
	src/client/cockpit-client.ui \
	$(NULL)

if ENABLE_COCKPIT_CLIENT
dist_cockpitclient_SCRIPTS += src/client/cockpit-client-ssh
endif
