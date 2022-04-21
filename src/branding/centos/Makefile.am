centosbrandingdir = $(datadir)/cockpit/branding/centos

dist_centosbranding_DATA = \
	src/branding/centos/branding.css \
	$(NULL)

# Opportunistically use fedora-logos
install-data-hook::
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/system-logo-white.png $(DESTDIR)$(centosbrandingdir)/logo.png
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/fedora-logo-sprite.png $(DESTDIR)$(centosbrandingdir)/apple-touch-icon.png
	ln -sTfr $(DESTDIR)/etc/favicon.png $(DESTDIR)$(centosbrandingdir)/favicon.ico
