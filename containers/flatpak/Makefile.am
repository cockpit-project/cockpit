COMMITTED_DIST += containers/flatpak/

FLATPAK_ID=org.cockpit_project.cockpit-client

flatpak.yml: $(srcdir)/containers/flatpak/flatpak.yml.in
	$(AM_V_GEN) sed 's,@distdir@,$(distdir),' $< > $@.tmp && $(MV) $@.tmp $@

$(FLATPAK_ID).flatpak: flatpak.yml
	rm -rf flatpak-build-dir flatpak-repo-dir
	XZ_OPT=-0 make dist
	flatpak-builder --disable-cache flatpak-build-dir $< --repo=flatpak-repo-dir
	flatpak build-bundle flatpak-repo-dir $@ $(FLATPAK_ID)

flatpak:
	rm -f $(FLATPAK_ID).flatpak
	make $(FLATPAK_ID).flatpak
