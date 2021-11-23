build-for-flatpak: $(BUILT_SOURCES)
	$(MAKE) cockpit-ws

install-for-flatpak: \
		install-cockpitwsPROGRAMS \
		install-defaultbrandingDATA \
		install-dist_applicationsDATA \
		install-dist_cockpitclientDATA \
		install-dist_cockpitclientSCRIPTS \
		install-dist_scalableiconDATA \
		install-dist_symboliciconDATA \
		$(NULL)
	$(MKDIR_P) $(DESTDIR)/$(bindir)
	ln -sfTv $(cockpitclientdir)/cockpit-client $(DESTDIR)/$(bindir)/cockpit-client
	cp -rT dist/static $(pkgdatadir)/static
	rm $(pkgdatadir)/static/Makefile.deps
