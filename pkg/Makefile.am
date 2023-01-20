pkg_TESTS = \
	pkg/users/test-list-public-keys.sh \
	$(NULL)

TESTS += $(pkg_TESTS)

%.metainfo.xml: %.metainfo.xml.in
	$(AM_V_GEN) mkdir -p $(dir $@) && msgfmt --xml -d $(top_srcdir)/po --template $< --output $@

metainfodir = ${datarootdir}/metainfo
nodist_metainfo_DATA = \
	pkg/sosreport/org.cockpit-project.cockpit-sosreport.metainfo.xml \
	pkg/kdump/org.cockpit-project.cockpit-kdump.metainfo.xml \
	pkg/selinux/org.cockpit-project.cockpit-selinux.metainfo.xml \
	pkg/storaged/org.cockpit-project.cockpit-storaged.metainfo.xml \
	pkg/networkmanager/org.cockpit-project.cockpit-networkmanager.metainfo.xml \
	$(NULL)

metainfo_in = $(patsubst %,%.in,$(nodist_metainfo_DATA))
EXTRA_DIST += $(metainfo_in)
CLEANFILES += $(nodist_metainfo_DATA)

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

# automake doesn't support stripping initial path components (ie: `dist`) with
# `nobase_`, so we create a cockpit/ symlink and use that instead.
# That way, the files land in $(datadir)/cockpit/ and `dist` is avoided.
all-local:: cockpit
cockpit:
	$(AM_V_GEN) ln -sf $(srcdir)/dist $@

nobase_data_DATA = $(patsubst dist/%,cockpit/%,$(WEBPACK_INSTALL))
