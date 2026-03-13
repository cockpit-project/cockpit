# SPDX-License-Identifier: LGPL-2.1-or-later
ubuntubrandingdir = $(datadir)/cockpit/branding/ubuntu

dist_ubuntubranding_DATA = \
	src/branding/ubuntu/branding.css \
	src/branding/ubuntu/favicon.ico \
	$(NULL)

# Icons provided by base-files package
install-data-hook::
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/ubuntu-logo-text.png $(DESTDIR)$(ubuntubrandingdir)/logo.png
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/ubuntu-logo-text-dark.png $(DESTDIR)$(ubuntubrandingdir)/logo-dark.png
	ln -sTfr $(DESTDIR)/usr/share/pixmaps/ubuntu-logo.svg $(DESTDIR)$(ubuntubrandingdir)/logo.svg
