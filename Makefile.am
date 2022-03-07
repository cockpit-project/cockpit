NULL =
BUILT_SOURCES =
CLEANFILES =
bin_PROGRAMS =
check_DATA =
check_SCRIPTS =
check_PROGRAMS =
noinst_SCRIPTS =
libexec_PROGRAMS =
libexec_SCRIPTS =
noinst_PROGRAMS =
sbin_PROGRAMS =
noinst_LIBRARIES =
noinst_DATA =
man_MANS =
nodist_noinst_DATA =
nodist_noinst_SCRIPTS =

TESTS = \
	test/check-dist \
	test/static-code \
	$(NULL)

EXTRA_DIST = \
	package.json \
	package-lock.json \
	README.md \
	tools/debian/copyright \
	$(NULL)

clean-local::
	find $(builddir) -name '*.gc??' -delete
	find $(srcdir) -name '*.pyc' -delete

# Webpack related
include pkg/build

# required for running unit and integration tests; commander and ws are deps of chrome-remote-interface
WEBPACK_TEST_DEPS = \
	node_modules/chrome-remote-interface \
	node_modules/commander \
	node_modules/sizzle \
	node_modules/ws \
	$(NULL)

install-data-local:: $(WEBPACK_INSTALL) $(MANIFESTS)
	mkdir -p $(DESTDIR)$(pkgdatadir)
	$(V_TAR) tar --format=posix -cf - $^ | tar --no-same-owner -C $(DESTDIR)$(pkgdatadir) --strip-components=1 -xvf -
install-data-local:: $(WEBPACK_GZ_INSTALL)
	@for file in $^; do \
		target="$(DESTDIR)$(pkgdatadir)/$${file##*dist/}.gz"; \
		[ -n "$(DESTDIR)" -a "$${target}" -nt "$${file}" ] && continue; \
		mkdir -p "$${target%/*}"; \
		echo "$${file} → $${target}"; \
		gzip -9 < "$${file}" > "$${target}"; \
	done
install-data-local:: $(wildcard $(top_srcdir)/dist/*/*.map)
	$(V_TAR) tar --format=posix -c --transform="s@.*dist/@$(debugdir)$(pkgdatadir)/@" -T/dev/null $^ | tar --no-same-owner -C $(DESTDIR)/ -xv
uninstall-local::
	test ! -d $(DESTDIR)$(pkgdatadir) || \
	  (find $(DESTDIR)$(pkgdatadir) -ignore_readdir_race -type f -exec rm -f {} \; && \
	   find $(DESTDIR)$(pkgdatadir) -ignore_readdir_race -type d -empty -delete)
	test ! -d $(DESTDIR)$(debugdir)$(pkgdatadir) || \
	  (find $(DESTDIR)$(debugdir)$(pkgdatadir) -ignore_readdir_race -type f -delete && \
	   find $(DESTDIR)$(debugdir)$(pkgdatadir) -ignore_readdir_race -type d -empty -delete)
dist-hook:: $(WEBPACK_INPUTS) $(WEBPACK_OUTPUTS) $(WEBPACK_TEST_DEPS) $(MANIFESTS)
	$(V_TAR) tar --format=posix -cf - $^ | tar -C $(distdir) -xf -
	cp $(srcdir)/tools/README.node_modules $(distdir)/node_modules/README
	( cd $(srcdir); git ls-tree HEAD --name-only -r $(COMMITTED_DIST) || (echo $(COMMITTED_DIST) | tr ' ' '\n' ) ) | \
		tar --format=posix -C $(srcdir) --exclude test/reference -cf - -T - | tar -C $(distdir) -xf -
	echo $(VERSION) > $(distdir)/.tarball
	tools/create-spec --version '$(VERSION)' -o $(distdir)/tools/cockpit.spec $(srcdir)/tools/cockpit.spec.in
	sed 's/VERSION/$(VERSION)/' $(srcdir)/tools/debian/changelog.in > $(distdir)/tools/debian/changelog
	sed 's/VERSION/$(VERSION)/' $(srcdir)/tools/arch/PKGBUILD.in > $(distdir)/tools/arch/PKGBUILD
	tools/adjust-distdir-timestamps "$(distdir)"

#

ACLOCAL_AMFLAGS = -I tools ${ACLOCAL_FLAGS}

DISTCHECK_CONFIGURE_FLAGS=						        \
	--disable-debug \
	--disable-coverage \
	--disable-silent-rules \
	--enable-prefix-only \
	$(NULL)

AM_CPPFLAGS = \
	-I$(top_srcdir)/src \
	-DSRCDIR=\"$(abs_srcdir)\" \
	-DBUILDDIR=\"$(abs_builddir)\" \
	-DDATADIR=\"$(datadir)\" \
	-DLIBEXECDIR=\""$(libexecdir)"\" \
	-DPACKAGE_SYSCONF_DIR=\""$(sysconfdir)"\" \
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

if ENABLE_DOC
DOCS_INSTALL_DEPS = dist/guide/html/index.html
else
DOCS_INSTALL_DEPS =
endif

install-data-local:: $(DOCS_INSTALL_DEPS)
if ENABLE_DOC
	mkdir -p $(DESTDIR)$(htmldir)
	$(INSTALL_DATA) $(dir $<)/* $(DESTDIR)$(htmldir)
else
	@true
endif

uninstall-local::
if ENABLE_DOC
	rm -rf $(DESTDIR)$(htmldir)
else
	@true
endif

# See test/image-prepare
dump-dist:
	@echo "$(abs_builddir)/$(distdir).tar.xz"

# Subdirectories to distribute everything that's committed to git
COMMITTED_DIST = \
	tools/ \
	test \
	$(NULL)

tools/debian/copyright: tools/debian/copyright.template $(MANIFESTS)
	$(AM_V_GEN) (cd $(srcdir) && NODE_ENV=$(NODE_ENV) ./tools/build-debian-copyright) > $@.tmp && \
	mv -f $@.tmp $@

# This is the stock rule with $(BUILT_SOURCES) dependency removed.
# In the future, we can do this via "no-dist-built-sources" automake option:
# https://git.savannah.gnu.org/cgit/automake.git/commit/?id=13659a7385
distdir:
	$(MAKE) $(AM_MAKEFLAGS) distdir-am

distcheck-hook::
	$(srcdir)/tools/check-dist $(distdir)

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
include src/retest/Makefile.am
include src/session/Makefile-session.am
include src/ssh/Makefile-ssh.am
include src/systemd/Makefile.am
include src/tls/Makefile-tls.am
include src/websocket/Makefile-websocket.am
include src/ws/Makefile-ws.am
include tools/Makefile-tools.am
