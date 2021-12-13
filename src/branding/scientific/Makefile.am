scientificbrandingdir = $(datadir)/cockpit/branding/scientific

scientificbranding_DATA = \
	src/branding/scientific/branding.css \
	$(NULL)

EXTRA_DIST += $(scientificbranding_DATA)

# Opportunistically use Scientific Linux logos. 
install-data-hook::
	ln -sf /usr/share/pixmaps/system-logo-white.png $(DESTDIR)$(scientificbrandingdir)/logo.png
	ln -sf /usr/share/pixmaps/fedora-logo-sprite.png $(DESTDIR)$(scientificbrandingdir)/apple-touch-icon.png
	ln -sf /etc/favicon.png $(DESTDIR)$(scientificbrandingdir)/favicon.ico

