build-for-flatpak: cockpit-ws

install-for-flatpak: \
		install-cockpitwsPROGRAMS \
		install-dist_defaultbrandingDATA \
		install-dist_applicationsDATA \
		install-dist_cockpitclientDATA \
		install-dist_cockpitclientSCRIPTS \
		install-dist_dbusservicesDATA \
		install-dist_scalableiconDATA \
		install-dist_symboliciconDATA \
		$(NULL)
	mkdir -p $(DESTDIR)/$(bindir)
	ln -sfTv $(cockpitclientdir)/cockpit-client $(DESTDIR)/$(bindir)/cockpit-client
	cp -rT dist/static $(pkgdatadir)/static
	rm $(pkgdatadir)/static/Makefile.deps
