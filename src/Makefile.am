BUILT_SOURCES =
bin_PROGRAMS =
libexec_PROGRAMS =
libexec_SCRIPTS =
sbin_PROGRAMS =

# -----------------------------------------------------------------------------
#  Python

# Will only be honoured if pytest-timeout plugin is installed
export PYTEST_TIMEOUT = 120

.PHONY: pytest
pytest: $(BUILT_SOURCES) $(DIST_STAMP) $(MANIFESTS)
	$(MAKE) test-server
	cd '$(srcdir)' && abs_builddir='$(abs_builddir)' pytest

.PHONY: pytest-cov
pytest-cov: $(BUILT_SOURCES) $(DIST_STAMP) $(MANIFESTS)
	$(MAKE) test-server
	cd '$(srcdir)' && abs_builddir='$(abs_builddir)' pytest --cov

if !WITH_OLD_BRIDGE
INSTALL_DATA_LOCAL_TARGETS += install-python
install-python:
	@# wheel-based installation with .dist-info.
	@# This needs to work on RHEL8 up through modern Fedora, offline, with
	@# system packages available to the build.
	python3 -m pip install --no-index --force-reinstall --root='$(DESTDIR)/' --prefix='$(prefix)' \
		"$$(python3 '$(srcdir)'/src/build_backend.py --wheel '$(srcdir)' tmp/wheel)"
	mkdir -p $(DESTDIR)$(libexecdir)
	mv -t $(DESTDIR)$(libexecdir) $(DESTDIR)$(bindir)/cockpit-askpass $(DESTDIR)$(bindir)/cockpit-beiboot

UNINSTALL_LOCAL_TARGETS += uninstall-python
uninstall-python:
	rm -rf tmp/wheel
	rm -f $(DESTDIR)$(libexecdir)/cockpit-askpass $(DESTDIR)$(libexecdir)/cockpit-beiboot
	rm -f $(DESTDIR)$(bindir)/cockpit-bridge
	@# HACK: pip uninstall does not know about --root and --prefix
	rm -r $(DESTDIR)$(prefix)/lib/python*/*-packages/cockpit \
	      $(DESTDIR)$(prefix)/lib/python*/*-packages/cockpit-*.dist-info
endif


# -----------------------------------------------------------------------------
#  C

AM_CPPFLAGS = \
	-I$(top_srcdir)/src \
	-DDATADIR=\"$(datadir)\" \
	-DLIBEXECDIR=\""$(libexecdir)"\" \
	-DPACKAGE_SYSCONF_DIR=\""$(sysconfdir)"\" \
	$(NULL)

AM_CFLAGS = \
	-std=gnu18 \
	-pthread \
	-Wall \
	-Werror=strict-prototypes \
	-Werror=missing-prototypes \
	-Werror=implicit-function-declaration \
	-Werror=implicit-int \
	-Werror=int-conversion \
	-Werror=old-style-definition \
	-Werror=pointer-arith \
	-Werror=init-self \
	-Werror=format=2 \
	-Werror=return-type \
	-Werror=missing-include-dirs \
	$(NULL)

# -----------------------------------------------------------------------------
#  AppStream metadata
#
%.metainfo.xml: %.metainfo.xml.in
	$(AM_V_GEN) mkdir -p $(dir $@) && msgfmt --xml -d $(top_srcdir)/po --template $< --output $@

metainfodir = ${datarootdir}/metainfo
nodist_metainfo_DATA = \
	src/appstream/org.cockpit-project.cockpit-sosreport.metainfo.xml \
	src/appstream/org.cockpit-project.cockpit-kdump.metainfo.xml \
	src/appstream/org.cockpit-project.cockpit-selinux.metainfo.xml \
	src/appstream/org.cockpit-project.cockpit-storaged.metainfo.xml \
	src/appstream/org.cockpit-project.cockpit-networkmanager.metainfo.xml \
	$(NULL)

metainfo_in = $(patsubst %,%.in,$(nodist_metainfo_DATA))
EXTRA_DIST += $(metainfo_in)
CLEANFILES += $(nodist_metainfo_DATA)
