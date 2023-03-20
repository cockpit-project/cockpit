pkg_TESTS = \
	pkg/users/test-list-public-keys.sh \
	$(NULL)

TESTS += $(pkg_TESTS)

pixmapsdir = ${datarootdir}/pixmaps
pixmaps_DATA = pkg/sosreport/cockpit-sosreport.png

EXTRA_DIST += \
	pkg/users/mock \
	pkg/lib/qunit-template.html \
	pkg/lib/cockpit-po-plugin.js \
	$(pkg_TESTS) \
	$(metainfo_DATA) \
	$(pixmaps_DATA) \
	$(NULL)

pcpmanifestdir = $(datadir)/cockpit/pcp
dist_pcpmanifest_DATA = pkg/pcp/manifest.json

sshmanifestdir = $(datadir)/cockpit/ssh
dist_sshmanifest_DATA = pkg/ssh/manifest.json

include pkg/build

# This is how the qunit tests get included.  We need to prevent automake from
# seeing them during ./autogen.sh, but need make to find them at compile time.
-include $(wildcard pkg/Makefile.qunit*)

install-data-hook::
	cd $(srcdir)/dist; find -type f -exec install -D -m 644 '{}' '$(DESTDIR)$(datadir)/cockpit/{}' \;

uninstall-hook:
	rm -rf $(DESTDIR)$(datadir)/cockpit
