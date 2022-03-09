fedorabrandingdir = $(datadir)/cockpit/branding/fedora

dist_fedorabranding_DATA = \
	src/branding/fedora/branding.css \
	$(NULL)

# Opportunistically use fedora-logos
install-data-hook::
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/system-logo-white.png $(DESTDIR)$(fedorabrandingdir)/logo.png
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/fedora-logo-sprite.png $(DESTDIR)$(fedorabrandingdir)/apple-touch-icon.png
	ln -sTfr $(DESTDIR)/etc/favicon.png $(DESTDIR)$(fedorabrandingdir)/favicon.ico
