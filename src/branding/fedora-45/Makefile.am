# SPDX-License-Identifier: LGPL-2.1-or-later
fedora45brandingdir = $(datadir)/cockpit/branding/fedora-45

dist_fedora45branding_DATA = \
	src/branding/fedora-45/branding.css \
	$(NULL)

# Fedora 43 and 44 use the same branding
install-data-hook::
	ln -sTfr $(DESTDIR)$(fedora45brandingdir) $(DESTDIR)$(datadir)/cockpit/branding/fedora-44
	ln -sTfr $(DESTDIR)$(fedora45brandingdir) $(DESTDIR)$(datadir)/cockpit/branding/fedora-43
