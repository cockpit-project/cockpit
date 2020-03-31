tumbleweedbrandingdir = $(datadir)/cockpit/branding/opensuse-tumbleweed

tumbleweedbranding_DATA = \
	src/branding/opensuse-tumbleweed/branding.css \
	$(NULL)

EXTRA_DIST += $(tumbleweedbranding_DATA)

install-data-hook::
	$(LN_S) -f /usr/share/wallpapers/default-1920x1200.jpg $(DESTDIR)$(tumbleweedbrandingdir)/default-1920x1200.jpg
	$(LN_S) -f /usr/share/pixmaps/distribution-logos/square-hicolor.svg $(DESTDIR)$(tumbleweedbrandingdir)/square-hicolor.svg
