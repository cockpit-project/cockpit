COMMITTED_DIST += containers/flatpak/

build-for-flatpak: $(BUILT_SOURCES)
	$(MAKE) cockpit-ws

install-for-flatpak: build-for-flatpak
	install -Dt $(bindir) containers/flatpak/cockpit-client
	install -Dt $(libexecdir) cockpit-ws containers/flatpak/cockpit-ssh
	:
	install -Dt $(datadir)/applications containers/flatpak/cockpit-client.desktop
	install -Dt $(datadir)/icons/hicolor/scalable/apps containers/flatpak/cockpit-client.svg
	install -Dt $(datadir)/icons/hicolor/symbolic/apps containers/flatpak/cockpit-client-symbolic.svg
	:
	install -Dt $(pkgdatadir)/branding/default $(defaultbranding_DATA)
	cp -rT dist/static $(pkgdatadir)/static
	rm $(pkgdatadir)/static/Makefile.deps
