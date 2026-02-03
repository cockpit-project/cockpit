# SPDX-License-Identifier: LGPL-2.1-or-later
opensusebrandingdir = $(datadir)/cockpit/branding/opensuse

dist_opensusebranding_DATA = \
	src/branding/opensuse/branding.css \
	$(NULL)

install-data-hook::
	ln -sTfr $(DESTDIR)/usr/share/wallpapers/openSUSEdefault/contents/images/default.png $(DESTDIR)$(opensusebrandingdir)/default.png
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/distribution-logos/square-hicolor.svg $(DESTDIR)$(opensusebrandingdir)/square-hicolor.svg
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/distribution-logos/favicon.ico $(DESTDIR)$(opensusebrandingdir)/favicon.ico
