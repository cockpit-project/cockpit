ubuntubrandingdir = $(datadir)/cockpit/branding/ubuntu

ubuntubranding_DATA = \
	src/branding/ubuntu/branding.css \
	$(NULL)

# Opportunistically use plymouth ubuntu logo
install-data-hook::
	$(LN_S) -f /usr/share/plymouth/ubuntu-logo.png $(DESTDIR)$(ubuntubrandingdir)/logo.png
