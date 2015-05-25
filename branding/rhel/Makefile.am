rhelbrandingdir = $(datadir)/cockpit/branding/rhel

rhelbranding_DATA = \
	branding/rhel/branding.css \
	branding/rhel/bg-login.jpg \
	$(NULL)

# Opportunistically use redhat-logos ... yes they're called 'fedora'
install-data-hook::
	$(LN_S) -f /usr/share/pixmaps/system-logo-white.png $(DESTDIR)$(rhelbrandingdir)/logo.png
	$(LN_S) -f /usr/share/pixmaps/fedora-logo-sprite.png $(DESTDIR)$(rhelbrandingdir)/apple-touch-icon.png
	$(LN_S) -f /etc/favicon.png $(DESTDIR)$(rhelbrandingdir)/favicon.ico
