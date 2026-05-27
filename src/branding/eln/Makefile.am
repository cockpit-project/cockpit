# SPDX-License-Identifier: LGPL-2.1-or-later

elnbrandingdir = $(datadir)/cockpit/branding/eln


dist_elnbranding_DATA = \
	src/branding/eln/branding.css \
	$(NULL)


# "Opportunistically use fedora-logos"
install-data-hook::
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/system-logo-white.png $(DESTDIR)$(elnbrandingdir)/logo.png
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/eln-logo-sprite.png $(DESTDIR)$(elnbrandingdir)/apple-touch-icon.png
	ln -sTfr $(DESTDIR)/etc/favicon.png $(DESTDIR)$(elnbrandingdir)/favicon.ico
