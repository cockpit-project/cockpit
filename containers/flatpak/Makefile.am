build-for-flatpak: cockpit-ws

INSTALL_FLATPAK_TARGETS = \
	install-cockpitwsPROGRAMS \
	install-dist_client_metainfoDATA \
	install-dist_defaultbrandingDATA \
	install-dist_applicationsDATA \
	install-dist_cockpitclientDATA \
	install-dist_cockpitclientSCRIPTS \
	install-dist_dbusservicesDATA \
	install-dist_scalableiconDATA \
	install-dist_symboliciconDATA \
	install-cockpit-client-symlink \
	$(NULL)

if WITH_PYBRIDGE
INSTALL_FLATPAK_TARGETS += install-python install-bundles
endif

install-for-flatpak: $(INSTALL_FLATPAK_TARGETS)
	appstream-util validate --nonet src/client/org.cockpit_project.CockpitClient.metainfo.xml
	if test -s "${DOWNSTREAM_RELEASES_XML}"; then \
	    $(top_srcdir)/tools/patch-metainfo \
	        '$(DESTDIR)$(datadir)/metainfo/org.cockpit_project.CockpitClient.metainfo.xml' \
	        "${DOWNSTREAM_RELEASES_XML}"; \
	fi
	appstream-util validate --nonet $(DESTDIR)$(datadir)/metainfo/org.cockpit_project.CockpitClient.metainfo.xml
	cp -rT dist/static $(DESTDIR)$(pkgdatadir)/static
	rm -rf $(DESTDIR)$(pkgdatadir)/apps $(DESTDIR)$(pkgdatadir)/playground
