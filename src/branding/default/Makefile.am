# SPDX-License-Identifier: LGPL-2.1-or-later
defaultbrandingdir = $(datadir)/cockpit/branding/default

dist_defaultbranding_DATA = \
	src/branding/default/apple-touch-icon.png \
	src/branding/default/branding.css \
	src/branding/default/brand-large.png \
	src/branding/default/favicon.ico \
	src/branding/default/logo.png \
	$(NULL)

EXTRA_DIST += src/branding/default/logo.svg

# Opportunistically use generic-logos for anaconda WebUI branding
install-data-hook::
	ln -sTfr $(DESTDIR)/usr/share/anaconda/pixmaps/webui.css $(DESTDIR)$(defaultbrandingdir)/anaconda-branding.css
	ln -sTfr $(DESTDIR)/usr/share/anaconda/pixmaps/webui-header-logo.png $(DESTDIR)$(defaultbrandingdir)/webui-header-logo.png
