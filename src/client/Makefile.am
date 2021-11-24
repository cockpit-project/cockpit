# We actually always install cockpit-client in libexec,
# but ENABLE_COCKPIT_CLIENT controls whether we install
# the desktop file, icons, a symlink in /usr/bin, and
# cockpit-client-ssh.
# This is currently **EXPERIMENTAL**

cockpitclientdir = $(libexecdir)
dist_cockpitclient_SCRIPTS = \
	src/client/cockpit-client \
	$(NULL)

dist_cockpitclient_DATA = \
	src/client/cockpit-client.ui \
	$(NULL)

install-exec-hook::
if ENABLE_COCKPIT_CLIENT
	$(MKDIR_P) $(DESTDIR)/$(bindir)
	ln -sfTv $(cockpitclientdir)/cockpit-client $(DESTDIR)/$(bindir)/cockpit-client

dist_cockpitclient_SCRIPTS += src/client/cockpit-client-ssh

applicationsdir = $(datadir)/applications
dist_applications_DATA = src/client/cockpit-client.desktop

scalableicondir = $(datadir)/icons/hicolor/scalable/apps
dist_scalableicon_DATA = src/client/cockpit-client.svg

symbolicicondir = $(datadir)/icons/hicolor/symbolic/apps
dist_symbolicicon_DATA = src/client/cockpit-client-symbolic.svg
endif
