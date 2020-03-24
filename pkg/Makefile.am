pkg_TESTS = \
	pkg/users/test-list-public-keys.sh \
	$(NULL)

TESTS += $(pkg_TESTS)

# Used for testing and the 'translate' playground
playgrounddir = $(pkgdatadir)/playground
playground_DATA = \
	dist/playground/po.extra.de.js \
	$(NULL)

dist/playground/extra.de.po: pkg/playground/extra.de.po
	$(COPY_RULE)

dist/playground/hammer.gif: pkg/playground/hammer.gif
	$(COPY_RULE)

dist/sosreport/sosreport.png: pkg/sosreport/sosreport.png
	$(COPY_RULE)

dist/apps/default.png: pkg/apps/default.png
	$(COPY_RULE)

dist/storaged/images/storage-array.png: pkg/storaged/images/storage-array.png
	$(COPY_RULE)

dist/storaged/images/storage-disk.png: pkg/storaged/images/storage-disk.png
	$(COPY_RULE)

dist/shell/images/server-error.png: pkg/shell/images/server-error.png
	$(COPY_RULE)

dist/shell/images/server-large.png: pkg/shell/images/server-large.png
	$(COPY_RULE)

dist/shell/images/server-small.png: pkg/shell/images/server-small.png
	$(COPY_RULE)

dist/shell/index.html: pkg/shell/index.html
	$(COPY_RULE)

metainfodir = ${datarootdir}/metainfo
metainfo_DATA = pkg/sosreport/org.cockpit-project.cockpit-sosreport.metainfo.xml \
		pkg/kdump/org.cockpit-project.cockpit-kdump.metainfo.xml \
		pkg/selinux/org.cockpit-project.cockpit-selinux.metainfo.xml \
		pkg/machines/org.cockpit-project.cockpit-machines.metainfo.xml \
		pkg/storaged/org.cockpit-project.cockpit-storaged.metainfo.xml \
		pkg/docker/org.cockpit-project.cockpit-docker.metainfo.xml \
		$(NULL)

pixmapsdir = ${datarootdir}/pixmaps
pixmaps_DATA = pkg/sosreport/cockpit-sosreport.png

EXTRA_DIST += \
	dist/playground/extra.de.po \
	pkg/playground/extra.de.po \
	pkg/users/mock \
	pkg/lib/qunit-template.html \
	$(playground_DATA) \
	$(pkg_TESTS) \
	$(metainfo_DATA) \
	$(pixmaps_DATA) \
	$(NULL)
