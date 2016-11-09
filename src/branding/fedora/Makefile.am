fedorabrandingdir = $(datadir)/cockpit/branding/fedora

fedorabranding_DATA = \
	src/branding/fedora/branding.css \
	$(NULL)

# Opportunistically use fedora-logos
install-data-hook::
	$(LN_S) -f /usr/share/pixmaps/system-logo-white.png $(DESTDIR)$(fedorabrandingdir)/logo.png
	$(LN_S) -f /usr/share/pixmaps/fedora-logo-sprite.png $(DESTDIR)$(fedorabrandingdir)/apple-touch-icon.png
	$(LN_S) -f /etc/favicon.png $(DESTDIR)$(fedorabrandingdir)/favicon.ico
