opensusebrandingdir = $(datadir)/cockpit/branding/opensuse

dist_opensusebranding_DATA = \
	src/branding/opensuse/branding.css \
	$(NULL)

install-data-hook::
	ln -sTfr $(DESTDIR)/usr/share/wallpapers/default-1920x1200.jpg $(DESTDIR)$(opensusebrandingdir)/default-1920x1200.jpg
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/distribution-logos/square-hicolor.svg $(DESTDIR)$(opensusebrandingdir)/square-hicolor.svg
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/distribution-logos/favicon.ico $(DESTDIR)$(opensusebrandingdir)/favicon.ico
