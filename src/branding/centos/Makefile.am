centosbrandingdir = $(datadir)/cockpit/branding/centos

centosbranding_DATA = \
	src/branding/centos/branding.css \
	$(NULL)

EXTRA_DIST += $(centosbranding_DATA)

# Opportunistically use fedora-logos
install-data-hook::
	ln -sf /usr/share/pixmaps/system-logo-white.png $(DESTDIR)$(centosbrandingdir)/logo.png
	ln -sf /usr/share/pixmaps/fedora-logo-sprite.png $(DESTDIR)$(centosbrandingdir)/apple-touch-icon.png
	ln -sf /etc/favicon.png $(DESTDIR)$(centosbrandingdir)/favicon.ico
