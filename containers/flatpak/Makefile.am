FLATPAK_ID=org.cockpit_project.CockpitClient

COMMITTED_DIST += containers/flatpak/
EXTRA_DIST += containers/flatpak/$(FLATPAK_ID).desktop


flatpak.yml: $(srcdir)/containers/flatpak/flatpak.yml.in
	$(AM_V_GEN) sed 's,@distdir@,$(distdir),' $< > $@.tmp && $(MV) $@.tmp $@

$(FLATPAK_ID).flatpak: flatpak.yml Makefile
	rm -rf flatpak-build-dir flatpak-repo-dir .flatpak-builder
	XZ_OPT=-0 make dist
	flatpak-builder --disable-rofiles-fuse --disable-cache flatpak-build-dir $< --repo=flatpak-repo-dir
	flatpak build-bundle flatpak-repo-dir $@ $(FLATPAK_ID)

flatpak:
	rm -f $(FLATPAK_ID).flatpak
	make $(FLATPAK_ID).flatpak

build-for-flatpak: $(BUILT_SOURCES)
	$(MAKE) cockpit-ws

install-for-flatpak: build-for-flatpak
	install -Dt /app/bin containers/flatpak/cockpit-client
	install -Dt /app/libexec cockpit-ws containers/flatpak/cockpit-ssh
	install -Dt /app/etc/xdg/cockpit containers/flatpak/cockpit.conf
	install -Dt /app/share/applications containers/flatpak/$(FLATPAK_ID).desktop
	install -DT src/branding/default/logo.svg /app/share/icons/hicolor/scalable/apps/$(FLATPAK_ID).svg
	install -Dt /app/share/metainfo containers/flatpak/$(FLATPAK_ID).metainfo.xml
	install -Dt /app/share/cockpit/branding/default $(defaultbranding_DATA)
	cp -rT dist/static /app/share/cockpit/static
	rm /app/share/cockpit/static/Makefile.deps
