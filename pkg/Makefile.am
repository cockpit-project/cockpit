pkg_TESTS = \
	pkg/users/test-list-public-keys.sh \
	$(NULL)

TESTS += $(pkg_TESTS)

icons64dir = ${datarootdir}/icons/hicolor/64x64/apps
dist_icons64_DATA = pkg/sosreport/cockpit-sosreport.png

EXTRA_DIST += \
	pkg/users/mock \
	pkg/lib/qunit-template.html.in \
	pkg/lib/cockpit-po-plugin.js \
	$(pkg_TESTS) \
	$(metainfo_DATA) \
	$(NULL)

# one built file in dist/ which we use as dependency
DIST_STAMP = $(srcdir)/dist/static/manifest.json

# dynamic pkg → dist dependency, to rebuild the bundles if any web related file changes
# exclude automake unit test log files
PKG_INPUTS = $(shell find $(srcdir)/pkg $(srcdir)/po -type f ! -name 'test*.trs' ! -name 'test*.log')

V_BUNDLE = $(V_BUNDLE_$(V))
V_BUNDLE_ = $(V_BUNDLE_$(AM_DEFAULT_VERBOSITY))
V_BUNDLE_0 = @echo "  BUNDLE   dist";

# delete the stamp first; esbuild does not touch it if the contents didn't change,
# but this is just a representative for all of dist/*
$(DIST_STAMP): $(srcdir)/package-lock.json $(PKG_INPUTS)
	@rm -f $(DIST_STAMP)
	$(V_BUNDLE) cd $(srcdir) && NODE_ENV='$(NODE_ENV)' tools/termschutz ./build.js

EXTRA_DIST += build.js files.js package.json package-lock.json

INSTALL_DATA_LOCAL_TARGETS += install-bundles
install-bundles:
	cd $(srcdir)/dist; find */* -type f ! -name '*.LEGAL.txt' -a ! -path 'playground/*' -exec install -D -m 644 '{}' '$(abspath $(DESTDIR)$(datadir))/cockpit/{}' \;
	find $(srcdir)/dist -name '*.LEGAL.txt' -exec install --target-directory '$(abspath $(DESTDIR)$(docdir))/legal' '{}' -D -m 644 '{}'  \;

UNINSTALL_LOCAL_TARGETS += uninstall-bundles
uninstall-bundles:
	rm -rf $(DESTDIR)$(datadir)/cockpit
