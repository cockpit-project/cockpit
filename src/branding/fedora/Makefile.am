fedorabrandingdir = $(datadir)/cockpit/branding/fedora

fedorabranding_DATA = \
	src/branding/fedora/branding.css \
	$(NULL)

EXTRA_DIST += $(fedorabranding_DATA)

# Opportunistically use fedora-logos
install-data-hook::
	ln -sf /usr/share/pixmaps/system-logo-white.png $(DESTDIR)$(fedorabrandingdir)/logo.png
	ln -sf /usr/share/pixmaps/fedora-logo-sprite.png $(DESTDIR)$(fedorabrandingdir)/apple-touch-icon.png
	ln -sf /etc/favicon.png $(DESTDIR)$(fedorabrandingdir)/favicon.ico
