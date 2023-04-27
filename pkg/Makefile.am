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

# dynamic pkg → dist dependency, to rebuild the bundles if any web related file changes
# exclude automake unit test log files
PKG_INPUTS = $(shell find $(srcdir)/pkg -type f ! -name 'test*.trs' ! -name 'test*.log')

V_BUNDLE = $(V_BUNDLE_$(V))
V_BUNDLE_ = $(V_BUNDLE_$(AM_DEFAULT_VERBOSITY))
V_BUNDLE_0 = @echo "  BUNDLE   dist";

# delete the stamp first; neither webpack nor esbuild touch it if the contents didn't change,
# but this is just a representative for all of dist/*
$(DIST_STAMP): $(srcdir)/package-lock.json $(PKG_INPUTS)
	@rm -f $(DIST_STAMP)
	$(V_BUNDLE) cd $(srcdir) && NODE_ENV='$(NODE_ENV)' tools/termschutz ./build.js

EXTRA_DIST += build.js files.js package.json package-lock.json

# This is how the qunit tests get included.  We need to prevent automake from
# seeing them during ./autogen.sh, but need make to find them at compile time.
# We don't run them in the pybridge case since they're part of `pytest`.
if !WITH_PYBRIDGE
-include $(wildcard pkg/Makefile.qunit*)
endif

install-data-hook::
	cd $(srcdir)/dist; find */* -type f -exec install -D -m 644 '{}' '$(abspath $(DESTDIR)$(datadir))/cockpit/{}' \;

uninstall-hook:
	rm -rf $(DESTDIR)$(datadir)/cockpit
