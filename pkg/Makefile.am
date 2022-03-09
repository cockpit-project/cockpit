pkg_TESTS = \
	pkg/users/test-list-public-keys.sh \
	$(NULL)

TESTS += $(pkg_TESTS)

metainfodir = ${datarootdir}/metainfo
metainfo_DATA = pkg/sosreport/org.cockpit-project.cockpit-sosreport.metainfo.xml \
		pkg/kdump/org.cockpit-project.cockpit-kdump.metainfo.xml \
		pkg/selinux/org.cockpit-project.cockpit-selinux.metainfo.xml \
		pkg/storaged/org.cockpit-project.cockpit-storaged.metainfo.xml \
		$(NULL)

pixmapsdir = ${datarootdir}/pixmaps
pixmaps_DATA = pkg/sosreport/cockpit-sosreport.png

EXTRA_DIST += \
	pkg/users/mock \
	pkg/lib/qunit-template.html \
	pkg/lib/cockpit-po-plugin.js \
	pkg/lib/variables.scss \
	pkg/lib/patternfly/patternfly-overrides-variables.scss \
	$(pkg_TESTS) \
	$(metainfo_DATA) \
	$(pixmaps_DATA) \
	$(NULL)

include pkg/build

INSTALL_DATA_LOCAL_TARGETS += install-webpack
install-webpack: $(WEBPACK_INSTALL) $(MANIFESTS)
	mkdir -p $(DESTDIR)$(pkgdatadir)
	$(V_TAR) tar --format=posix -cf - $^ | tar --no-same-owner -C $(DESTDIR)$(pkgdatadir) --strip-components=1 -xvf -

INSTALL_DATA_LOCAL_TARGETS += install-webpack-gz
install-webpack-gz: $(WEBPACK_GZ_INSTALL)
	@for file in $^; do \
		target="$(DESTDIR)$(pkgdatadir)/$${file##*dist/}.gz"; \
		[ -n "$(DESTDIR)" -a "$${target}" -nt "$${file}" ] && continue; \
		mkdir -p "$${target%/*}"; \
		echo "$${file} → $${target}"; \
		gzip -9 < "$${file}" > "$${target}"; \
	done

INSTALL_DATA_LOCAL_TARGETS += install-webpack-map
install-webpack-map: $(wildcard $(top_srcdir)/dist/*/*.map)
	$(V_TAR) tar --format=posix -c --transform="s@.*dist/@$(debugdir)$(pkgdatadir)/@" -T/dev/null $^ | tar --no-same-owner -C $(DESTDIR)/ -xv

UNINSTALL_LOCAL_TARGETS += uninstall-webpack
uninstall-webpack:
	test ! -d $(DESTDIR)$(pkgdatadir) || \
	  (find $(DESTDIR)$(pkgdatadir) -ignore_readdir_race -type f -exec rm -f {} \; && \
	   find $(DESTDIR)$(pkgdatadir) -ignore_readdir_race -type d -empty -delete)
	test ! -d $(DESTDIR)$(debugdir)$(pkgdatadir) || \
	  (find $(DESTDIR)$(debugdir)$(pkgdatadir) -ignore_readdir_race -type f -delete && \
	   find $(DESTDIR)$(debugdir)$(pkgdatadir) -ignore_readdir_race -type d -empty -delete)
