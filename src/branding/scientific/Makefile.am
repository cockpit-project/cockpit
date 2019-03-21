scientificbrandingdir = $(datadir)/cockpit/branding/scientific

scientificbranding_DATA = \
	src/branding/scientific/branding.css \
	$(NULL)

EXTRA_DIST += $(scientificbranding_DATA)

# Opportunistically use Scientific Linux logos. 
install-data-hook::
	$(LN_S) -f /usr/share/pixmaps/system-logo-white.png $(DESTDIR)$(scientificbrandingdir)/logo.png
	$(LN_S) -f /usr/share/pixmaps/fedora-logo-sprite.png $(DESTDIR)$(scientificbrandingdir)/apple-touch-icon.png
	$(LN_S) -f /etc/favicon.png $(DESTDIR)$(scientificbrandingdir)/favicon.ico

