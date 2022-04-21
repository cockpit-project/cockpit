rhelbrandingdir = $(datadir)/cockpit/branding/rhel

dist_rhelbranding_DATA = \
	src/branding/rhel/branding.css \
	$(NULL)

# Opportunistically use redhat-logos ... yes they're called 'fedora'
install-data-hook::
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/system-logo-white.png $(DESTDIR)$(rhelbrandingdir)/logo.png
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/fedora-logo-sprite.png $(DESTDIR)$(rhelbrandingdir)/apple-touch-icon.png
	ln -sTfr $(DESTDIR)/etc/favicon.png $(DESTDIR)$(rhelbrandingdir)/favicon.ico
