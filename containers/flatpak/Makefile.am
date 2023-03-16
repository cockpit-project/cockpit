build-for-flatpak: cockpit-ws

install-for-flatpak: \
		install-cockpitwsPROGRAMS \
		install-dist_client_metainfoDATA \
		install-dist_defaultbrandingDATA \
		install-dist_applicationsDATA \
		install-dist_cockpitclientDATA \
		install-dist_cockpitclientSCRIPTS \
		install-dist_dbusservicesDATA \
		install-dist_scalableiconDATA \
		install-dist_symboliciconDATA \
		$(NULL)
	appstream-util validate --nonet src/client/org.cockpit_project.CockpitClient.metainfo.xml
	if test -s "${DOWNSTREAM_RELEASES_XML}"; then \
	    $(top_srcdir)/tools/patch-metainfo \
	        '$(DESTDIR)$(datadir)/metainfo/org.cockpit_project.CockpitClient.metainfo.xml' \
	        "${DOWNSTREAM_RELEASES_XML}"; \
	fi
	appstream-util validate --nonet $(DESTDIR)$(datadir)/metainfo/org.cockpit_project.CockpitClient.metainfo.xml
	mkdir -p $(DESTDIR)/$(bindir)
	ln -sfTv $(cockpitclientdir)/cockpit-client $(DESTDIR)/$(bindir)/cockpit-client
	cp -rT dist/static $(pkgdatadir)/static
