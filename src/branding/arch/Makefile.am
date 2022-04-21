archbrandingdir = $(datadir)/cockpit/branding/arch

dist_archbranding_DATA = \
	src/branding/arch/branding.css \
	$(NULL)

install-data-hook::
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/archlinux-logo.png $(DESTDIR)$(archbrandingdir)/logo.png
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/archlinux-logo.png $(DESTDIR)$(archbrandingdir)/apple-touch-icon.png
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/archlinux-logo.png $(DESTDIR)$(archbrandingdir)/favicon.ico
