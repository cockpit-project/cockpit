centosbrandingdir = $(datadir)/cockpit/branding/centos

centosbranding_DATA = \
	branding/centos/branding.css \
	branding/centos/bg-login.jpg \
	$(NULL)

# Opportunistically use fedora-logos
install-data-hook::
	$(LN_S) -f /usr/share/pixmaps/system-logo-white.png $(DESTDIR)$(centosbrandingdir)/logo.png
	$(LN_S) -f /usr/share/pixmaps/fedora-logo-sprite.png $(DESTDIR)$(centosbrandingdir)/apple-touch-icon.png
	$(LN_S) -f /etc/favicon.png $(DESTDIR)$(centosbrandingdir)/favicon.ico
