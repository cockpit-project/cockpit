NULL =
CLEANFILES =
dist_noinst_DATA =
man_MANS =
noinst_DATA =
noinst_LIBRARIES =
noinst_PROGRAMS =

# -----------------------------------------------------------------------------
#  make dist

EXTRA_DIST = README.md
CLEANFILES += cockpit-*.tar.xz

# We override distdir as we want to dist some git-tracked files and dist/ without explicitly listing
EXTRA_DIST += $(EXTRA_FILES)
distdir: $(DISTFILES)
	@if [ -e '$(srcdir)/.git' ]; then \
		git -C '$(srcdir)' ls-files -x test/reference .fmf plans pkg test tools > .extra_dist.tmp && \
		mv .extra_dist.tmp '$(srcdir)/.extra_dist'; fi
	$(MAKE) $(AM_MAKEFLAGS) distdir-am EXTRA_FILES="$$(tr '\n' ' ' < $(srcdir)/.extra_dist) .extra_dist"
	sed -i "s/[@]VERSION@/$(VERSION)/" "$(distdir)/src/client/org.cockpit_project.CockpitClient.metainfo.xml"
	sed -i "/^Version:/ s/0/$(VERSION)/" "$(distdir)/tools/cockpit.spec"
	sed -i "/^pkgver=/ s/0/$(VERSION)/" "$(distdir)/tools/arch/PKGBUILD"
	sed -i "1 s/0/$(VERSION)/" "$(distdir)/tools/debian/changelog"
	cp -r "$(srcdir)/dist" "$(distdir)"
	$(srcdir)/tools/adjust-distdir-timestamps "$(distdir)"
	@echo '  DIST     $(DIST_ARCHIVES)'

# Needed to ensure the tarball is correct for $(VERSION) override
$(distdir)/version.m4: FORCE
	@rm -f $(distdir)/version.m4
	$(AM_V_GEN) echo 'm4_define(VERSION_NUMBER, [$(VERSION)])' > $@

# be careful not to include autotools cache into dist tarballs
dist-hook: $(distdir)/configure
$(distdir)/configure: $(distdir)/version.m4
	@rm -f $(distdir)/configure
	$(AM_V_GEN) autoreconf $(distdir)
	@rm -r $(distdir)/autom4te.cache

# Various downstream packaging assets
dist-hook: $(distdir)/tools/debian/copyright
$(distdir)/tools/debian/copyright: $(DIST_STAMP)
	$(AM_V_GEN) NODE_ENV=$(NODE_ENV) $(srcdir)/tools/build-debian-copyright > $@

DISTCHECK_CONFIGURE_FLAGS = --enable-prefix-only

# Validate our AppStream metadata
distcheck-hook::
	find $(distdir) -name '*.metainfo.xml' -o -name '*.appdata.xml' | xargs appstream-util validate --nonet

# validate that we don't bundle fonts in webpacks
distcheck-hook::
	! grep --color=auto -rn "\.\./fonts/OpenSans\|fonts/.*eot\|truetype" $(distdir)/dist

# -----------------------------------------------------------------------------

TESTS = \
	test/static-code \
	$(NULL)

clean-local::
	find $(builddir) -name '*.gc??' -delete
	find $(srcdir) -name '*.pyc' -delete

# required for running unit and integration tests; commander and ws are deps of chrome-remote-interface
EXTRA_DIST += \
	node_modules/chrome-remote-interface \
	node_modules/commander \
	node_modules/sizzle \
	node_modules/ws \
	$(NULL)

check: export VERBOSE=1

TEST_EXTENSIONS = .html .sh
HTML_LOG_COMPILER = $(top_srcdir)/test/common/tap-cdp --strip=$(abs_top_srcdir)/ $(HTML_TEST_WRAPPER) ./test-server $(COCKPIT_BRIDGE)

VALGRIND = valgrind --trace-children=yes --quiet --error-exitcode=33 --gen-suppressions=all \
	$(foreach file,$(wildcard $(srcdir)/tools/*.supp),--suppressions=$(file)) \
	--num-callers=16 --leak-check=yes --show-leak-kinds=definite \
	--errors-for-leak-kinds=definite --trace-children-skip='*mock*,/bin*,/usr/bin/*,/usr/local/bin'

check-memory:
	$(MAKE) LOG_FLAGS="$(VALGRIND)" \
	        HTML_TEST_WRAPPER="$(VALGRIND)" \
		COCKPIT_SKIP_SLOW_TESTS=1 \
		$(AM_MAKEFLAGS) check TESTS="$(filter-out test/% bots/%,$(TESTS))"
recheck-memory:
	$(MAKE) LOG_FLAGS="$(VALGRIND_ARGS)" \
	        HTML_TEST_WRAPPER="$(VALGRIND)" \
		$(AM_MAKEFLAGS) recheck

# checkout Cockpit's bots for standard test VM images and API to launch them
# must be from main, as only that has current and existing images; but testvm.py API is stable
# support CI testing against a bots change
bots:
	tools/make-bots

.PHONY: rsync
RSYNC_HOST ?= c
RSYNC_DEST ?= $(RSYNC_HOST):/
rsync:
	$(MAKE)
	$(MAKE) install DESTDIR=tmp/rsync >/dev/null
	rsync --recursive --links --checksum --verbose --inplace tmp/rsync/ $(RSYNC_DEST)

CLEANFILES += compile_commands.json
noinst_DATA += compile_commands.json
compile_commands.json: Makefile
	$(AM_V_GEN) $(srcdir)/tools/make-compile-commands


# We use these to add conditionally-enabled extra rules
# automake doesn't like mixing `::` and `if`

CHECK_LOCAL_TARGETS =
.PHONY: $(CHECK_LOCAL_TARGETS)
check-local:: $(CHECK_LOCAL_TARGETS)

CLEAN_LOCAL_TARGETS =
.PHONY: $(CLEAN_LOCAL_TARGETS)
clean-local:: $(CLEAN_LOCAL_TARGETS)

INSTALL_DATA_LOCAL_TARGETS =
.PHONY: $(INSTALL_DATA_LOCAL_TARGETS)
install-data-local:: $(INSTALL_DATA_LOCAL_TARGETS)

INSTALL_EXEC_HOOK_TARGETS =
.PHONY: $(INSTALL_EXEC_HOOK_TARGETS)
install-exec-hook:: $(INSTALL_EXEC_HOOK_TARGETS)

UNINSTALL_LOCAL_TARGETS =
.PHONY: $(UNINSTALL_LOCAL_TARGETS)
uninstall-local:: $(UNINSTALL_LOCAL_TARGETS)


# This Makefile includes several variable definitions that must come first
include src/testlib/Makefile.am

include containers/Makefile.am
include containers/flatpak/Makefile.am
include doc/Makefile-doc.am
include doc/guide/Makefile-guide.am
include doc/man/Makefile-man.am
include pkg/Makefile.am
include po/Makefile.am
include selinux/Makefile.am
include src/Makefile.am
include src/branding/arch/Makefile.am
include src/branding/centos/Makefile.am
include src/branding/debian/Makefile.am
include src/branding/default/Makefile.am
include src/branding/fedora/Makefile.am
include src/branding/kubernetes/Makefile.am
include src/branding/opensuse/Makefile.am
include src/branding/registry/Makefile.am
include src/branding/rhel/Makefile.am
include src/branding/scientific/Makefile.am
include src/branding/ubuntu/Makefile.am
include src/bridge/Makefile.am
include src/client/Makefile.am
include src/common/Makefile-common.am
include src/pam-ssh-add/Makefile.am
include src/session/Makefile-session.am
include src/ssh/Makefile-ssh.am
include src/systemd/Makefile.am
include src/tls/Makefile-tls.am
include src/websocket/Makefile-websocket.am
include src/ws/Makefile-ws.am
include tools/Makefile-tools.am
