NULL =
BUILT_SOURCES =
CLEANFILES =
bin_PROGRAMS =
dist_noinst_DATA =
libexec_PROGRAMS =
libexec_SCRIPTS =
man_MANS =
noinst_DATA =
noinst_LIBRARIES =
noinst_PROGRAMS =
sbin_PROGRAMS =

# -----------------------------------------------------------------------------
#  make dist

EXTRA_DIST = README.md

# We override distdir for two reasons:
#  - we need to make sure DISTFILES is built before calling `make distdir-am`
#    to ensure that the Makefile.deps from the webpack build are available
#  - we want to dist all files in tools/ and test/ without explicitly listing
EXTRA_DIST += $(EXTRA_FILES)
distdir: $(DISTFILES)
	@if [ -e '$(srcdir)/.git' ]; then \
		git -C '$(srcdir)' ls-files -x test/reference test tools > .extra_dist.tmp && \
		mv .extra_dist.tmp '$(srcdir)/.extra_dist'; fi
	$(MAKE) $(AM_MAKEFLAGS) distdir-am EXTRA_FILES="$$(tr '\n' ' ' < $(srcdir)/.extra_dist) .extra_dist"

dist-hook:
	echo $(VERSION) > $(distdir)/.tarball
	$(srcdir)/tools/create-spec --version '$(VERSION)' -o $(distdir)/tools/cockpit.spec $(srcdir)/tools/cockpit.spec.in
	sed 's/VERSION/$(VERSION)/' $(srcdir)/tools/debian/changelog.in > $(distdir)/tools/debian/changelog
	NODE_ENV=$(NODE_ENV) $(srcdir)/tools/build-debian-copyright > $(distdir)/tools/debian/copyright
	sed 's/VERSION/$(VERSION)/' $(srcdir)/tools/arch/PKGBUILD.in > $(distdir)/tools/arch/PKGBUILD
	$(srcdir)/tools/adjust-distdir-timestamps "$(distdir)"
	@echo '  DIST     $(DIST_ARCHIVES)'

DISTCHECK_CONFIGURE_FLAGS = --enable-prefix-only

distcheck-hook:
	$(srcdir)/tools/check-dist $(distdir)

dump-dist:
	@echo "$(abs_builddir)/$(distdir).tar.xz"

# -----------------------------------------------------------------------------

TESTS = \
	test/check-dist \
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

AM_CPPFLAGS = \
	-I$(top_srcdir)/src \
	-DDATADIR=\"$(datadir)\" \
	-DLIBEXECDIR=\""$(libexecdir)"\" \
	-DPACKAGE_SYSCONF_DIR=\""$(sysconfdir)"\" \
	$(NULL)

AM_CFLAGS = \
	-pthread \
	-Wall \
	-Werror=strict-prototypes \
	-Werror=missing-prototypes \
	-Werror=implicit-function-declaration \
	-Werror=pointer-arith -Werror=init-self \
	-Werror=format=2 \
	-Werror=return-type \
	-Werror=missing-include-dirs \
	$(NULL)

LOG_DRIVER = $(PYTHON) $(top_srcdir)/tools/tap-driver
LOG_COMPILER = sh -c 'timeout 300 "$$0" "$$@" --tap' # For GLib < 2.62

TEST_EXTENSIONS = .html .sh
SH_LOG_DRIVER = $(LOG_DRIVER)
HTML_LOG_DRIVER = $(LOG_DRIVER)
HTML_TEST_SERVER = $(builddir)/test-server

HTML_LOG_COMPILER = timeout 60 $(PYTHON) $(top_srcdir)/test/common/tap-cdp --strip=$(abs_top_srcdir)/ -- $(HTML_TEST_SERVER)

VALGRIND_ARGS = --trace-children=yes --quiet --error-exitcode=33 --gen-suppressions=all \
	$(foreach file,$(VALGRIND_SUPPRESSIONS),--suppressions=$(file)) \
	--num-callers=16 --leak-check=yes --show-leak-kinds=definite \
	--errors-for-leak-kinds=definite --trace-children-skip='*mock*,/bin*,/usr/bin/*,/usr/local/bin'
VALGRIND_SUPPRESSIONS = \
	tools/glib.supp \
	tools/libssh.supp \
	tools/polkit.supp \
	tools/gnutls.supp \
	tools/valgrind.supp \
	$(NULL)

check-memory:
	$(MAKE) LOG_FLAGS="valgrind $(VALGRIND_ARGS)" \
	        HTML_LOG_FLAGS="valgrind $(VALGRIND_ARGS)" \
		COCKPIT_SKIP_SLOW_TESTS=1 \
		$(AM_MAKEFLAGS) check TESTS="$(filter-out test/% bots/%,$(TESTS))"
recheck-memory:
	$(MAKE) LOG_FLAGS="-- valgrind $(VALGRIND_ARGS)" \
	        HTML_LOG_FLAGS="valgrind $(VALGRIND_ARGS)" \
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
