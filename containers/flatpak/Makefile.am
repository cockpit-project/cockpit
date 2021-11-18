COMMITTED_DIST += containers/flatpak/

build-for-flatpak: $(BUILT_SOURCES)
	$(MAKE) cockpit-ws

install-for-flatpak: build-for-flatpak
	install -Dt /app/bin containers/flatpak/cockpit-client
	install -Dt /app/libexec cockpit-ws containers/flatpak/cockpit-ssh
	install -Dt /app/etc/xdg/cockpit containers/flatpak/cockpit.conf
	:
	install -Dt /app/share/applications containers/flatpak/cockpit-client.desktop
	install -Dt /app/share/icons/hicolor/scalable/apps containers/flatpak/cockpit-client.svg
	install -Dt /app/share/icons/hicolor/symbolic/apps containers/flatpak/cockpit-client-symbolic.svg
	:
	install -Dt /app/share/cockpit/branding/default $(defaultbranding_DATA)
	cp -rT dist/static /app/share/cockpit/static
	rm /app/share/cockpit/static/Makefile.deps
