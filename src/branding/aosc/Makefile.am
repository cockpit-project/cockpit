aoscbrandingdir = $(datadir)/cockpit/branding/aosc

dist_aoscbranding_DATA = \
	src/branding/aosc/branding.css \
	$(NULL)

install-data-hook::
	ln -sTfr $(DESTDIR)/usr/share/cockpit/aosc-branding/backdrop.jpg $(DESTDIR)$(aoscbrandingdir)/backdrop.jpg
	ln -sTfr $(DESTDIR)/usr/share/cockpit/aosc-branding/apple-touch-icon.png $(DESTDIR)$(aoscbrandingdir)/apple-touch-icon.png
	ln -sTfr $(DESTDIR)/usr/share/cockpit/aosc-branding/favicon.ico $(DESTDIR)$(aoscbrandingdir)/favicon.ico
