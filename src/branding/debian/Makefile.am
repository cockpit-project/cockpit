debianbrandingdir = $(datadir)/cockpit/branding/debian

debianbranding_DATA = \
	src/branding/debian/branding.css \
	$(NULL)

# Opportunistically use debconf debian logos
install-data-hook::
	$(LN_S) -f /usr/share/pixmaps/debian-logo.png $(DESTDIR)$(debianbrandingdir)/logo.png
	$(LN_S) -f /usr/share/pixmaps/debian-logo.png $(DESTDIR)$(debianbrandingdir)/favicon.ico
