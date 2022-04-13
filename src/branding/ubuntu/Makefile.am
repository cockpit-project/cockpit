ubuntubrandingdir = $(datadir)/cockpit/branding/ubuntu

dist_ubuntubranding_DATA = \
	src/branding/ubuntu/branding.css \
	src/branding/ubuntu/favicon.ico \
	$(NULL)

# Opportunistically use plymouth ubuntu logo
install-data-hook::
	ln -sTfr $(DESTDIR)/usr/share/plymouth/ubuntu-logo.png $(DESTDIR)$(ubuntubrandingdir)/logo.png
