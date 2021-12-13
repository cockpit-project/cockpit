archbrandingdir = $(datadir)/cockpit/branding/arch

archbranding_DATA = \
	src/branding/arch/branding.css \
	$(NULL)

EXTRA_DIST += $(archbranding_DATA)

install-data-hook::
	ln -sf /usr/share/pixmaps/archlinux-logo.png $(DESTDIR)$(archbrandingdir)/logo.png
	ln -sf /usr/share/pixmaps/archlinux-logo.png $(DESTDIR)$(archbrandingdir)/apple-touch-icon.png
	ln -sf /usr/share/pixmaps/archlinux-logo.png $(DESTDIR)$(archbrandingdir)/favicon.ico
