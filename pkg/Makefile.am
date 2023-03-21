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

# one built file in dist/ which we use as dependency
DIST_STAMP = $(srcdir)/dist/static/manifest.json

V_BUNDLE = $(V_BUNDLE_$(V))
V_BUNDLE_ = $(V_BUNDLE_$(AM_DEFAULT_VERBOSITY))
V_BUNDLE_0 = @echo "  BUNDLE   dist";

$(DIST_STAMP): $(srcdir)/package-lock.json
	$(V_BUNDLE) cd $(srcdir) && NODE_ENV='$(NODE_ENV)' tools/termschutz -- tools/webpack-make.js --test-mtime "$(DIST_STAMP)"

EXTRA_DIST += webpack.config.js package.json package-lock.json

# This is how the qunit tests get included.  We need to prevent automake from
# seeing them during ./autogen.sh, but need make to find them at compile time.
-include $(wildcard pkg/Makefile.qunit*)

install-data-hook::
	cd $(srcdir)/dist; find -type f -exec install -D -m 644 '{}' '$(DESTDIR)$(datadir)/cockpit/{}' \;

uninstall-hook:
	rm -rf $(DESTDIR)$(datadir)/cockpit
