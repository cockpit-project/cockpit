# We actually always install cockpit-client in libexec,
# but ENABLE_COCKPIT_CLIENT controls whether we install
# the desktop files, icons, and a symlink in /usr/bin.
# This is currently **EXPERIMENTAL**

cockpitclientdir = $(libexecdir)
dist_cockpitclient_SCRIPTS = \
	src/client/cockpit-client \
	src/client/cockpit-client-ssh \
	$(NULL)

dist_cockpitclient_DATA = \
	src/client/cockpit-client.ui \
	$(NULL)

install-exec-hook::
if ENABLE_COCKPIT_CLIENT
	$(MKDIR_P) $(DESTDIR)/$(bindir)
	ln -sfTv $(cockpitclientdir)/cockpit-client $(DESTDIR)/$(bindir)/cockpit-client

applicationsdir = $(datadir)/applications
dist_applications_DATA = src/client/cockpit-client.desktop

scalableicondir = $(datadir)/icons/hicolor/scalable/apps
dist_scalableicon_DATA = src/client/cockpit-client.svg

symbolicicondir = $(datadir)/icons/hicolor/symbolic/apps
dist_symbolicicon_DATA = src/client/cockpit-client-symbolic.svg
endif
