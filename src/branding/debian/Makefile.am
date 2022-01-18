debianbrandingdir = $(datadir)/cockpit/branding/debian

debianbranding_DATA = \
	src/branding/debian/branding.css \
	$(NULL)

EXTRA_DIST += $(debianbranding_DATA)

# Opportunistically use debconf debian logos
install-data-hook::
	ln -sTfr $(DESTDIR)usr/share/pixmaps/debian-logo.png $(DESTDIR)$(debianbrandingdir)/logo.png
	ln -sTfr $(DESTDIR)usr/share/pixmaps/debian-logo.png $(DESTDIR)$(debianbrandingdir)/favicon.ico
