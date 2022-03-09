scientificbrandingdir = $(datadir)/cockpit/branding/scientific

dist_scientificbranding_DATA = \
	src/branding/scientific/branding.css \
	$(NULL)

# Opportunistically use Scientific Linux logos. 
install-data-hook::
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/system-logo-white.png $(DESTDIR)$(scientificbrandingdir)/logo.png
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/fedora-logo-sprite.png $(DESTDIR)$(scientificbrandingdir)/apple-touch-icon.png
	ln -sTfr $(DESTDIR)/etc/favicon.png $(DESTDIR)$(scientificbrandingdir)/favicon.ico

