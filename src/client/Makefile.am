# -----------------------------------------------------------------------------
# Cockpit Client

# We actually always install cockpit-client in libexec,
# but ENABLE_COCKPIT_CLIENT controls whether we install
# the desktop file, icons, a symlink in /usr/bin, and
# cockpit-client-ssh.
# This is currently **EXPERIMENTAL**

cockpitclientdir = $(libexecdir)
dist_cockpitclient_SCRIPTS = src/client/cockpit-client
dist_cockpitclient_DATA = src/client/cockpit-client.ui

if ENABLE_COCKPIT_CLIENT

INSTALL_EXEC_HOOK_TARGETS += install-cockpit-client-symlink
install-cockpit-client-symlink:
	mkdir -p $(DESTDIR)/$(bindir)
	ln -sfTv $(cockpitclientdir)/cockpit-client $(DESTDIR)/$(bindir)/cockpit-client

dist_cockpitclient_SCRIPTS += src/client/cockpit-client-ssh

if WITH_PYBRIDGE
dist_cockpitclient_SCRIPTS += src/client/cockpit-beiboot
endif

dbusservicesdir = $(datadir)/dbus-1/services
dist_dbusservices_DATA = src/client/org.cockpit_project.CockpitClient.service

applicationsdir = $(datadir)/applications
dist_applications_DATA = src/client/org.cockpit_project.CockpitClient.desktop

scalableicondir = $(datadir)/icons/hicolor/scalable/apps
dist_scalableicon_DATA = src/client/cockpit-client.svg

symbolicicondir = $(datadir)/icons/hicolor/symbolic/apps
dist_symbolicicon_DATA = src/client/cockpit-client-symbolic.svg

client_metainfodir = $(datadir)/metainfo
dist_client_metainfo_DATA = src/client/org.cockpit_project.CockpitClient.metainfo.xml

endif
