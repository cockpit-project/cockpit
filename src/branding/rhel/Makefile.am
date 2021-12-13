rhelbrandingdir = $(datadir)/cockpit/branding/rhel

rhelbranding_DATA = \
	src/branding/rhel/branding.css \
	$(NULL)

EXTRA_DIST += $(rhelbranding_DATA)

# Opportunistically use redhat-logos ... yes they're called 'fedora'
install-data-hook::
	ln -sf /usr/share/pixmaps/system-logo-white.png $(DESTDIR)$(rhelbrandingdir)/logo.png
	ln -sf /usr/share/pixmaps/fedora-logo-sprite.png $(DESTDIR)$(rhelbrandingdir)/apple-touch-icon.png
	ln -sf /etc/favicon.png $(DESTDIR)$(rhelbrandingdir)/favicon.ico
