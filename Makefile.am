NULL =
man_MANS =
BUILT_SOURCES =
bin_PROGRAMS =
check_SCRIPTS =
check_PROGRAMS =
noinst_SCRIPTS =
libexec_PROGRAMS =
noinst_PROGRAMS =
sbin_PROGRAMS =
noinst_LIBRARIES =
noinst_DATA =
nodist_noinst_DATA =
nodist_noinst_SCRIPTS =

dist_systemdunit_DATA   =
nodist_systemdunit_DATA =

TESTS = $(NULL)

CLEANFILES = \
	$(man_MANS) \
	valgrind-suppressions \
	$(NULL)

EXTRA_DIST = \
	selinux \
	package.json \
	package-lock.json \
	README.md \
	tools/debian/copyright \
	$(NULL)

clean-local::
	find $(builddir) -name '*.gc??' -delete
	find $(srcdir) -name '*.pyc' -delete

SUFFIXES = \
	.jsx \
	.mo .po \
	.service .service.in \
	.socket .socket.in \
	.1 .8 .5 \
	$(NULL)

MV = mv -f

SUBST_RULE = \
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && sed \
	-e 's,[@]PACKAGE[@],$(PACKAGE),g' \
	-e 's,[@]admin_group[@],$(admin_group),g' \
	-e 's,[@]datadir[@],$(datadir),g' \
	-e 's,[@]group[@],$(COCKPIT_GROUP),g' \
	-e 's,[@]libexecdir[@],$(libexecdir),g' \
	-e 's,[@]prefix[@],$(prefix),g' \
	-e 's,[@]sysconfdir[@],$(sysconfdir),g' \
	-e 's,[@]user[@],$(COCKPIT_USER),g' \
	-e 's,[@]wsinstancegroup[@],$(COCKPIT_WSINSTANCE_GROUP),g' \
	-e 's,[@]wsinstanceuser[@],$(COCKPIT_WSINSTANCE_USER),g' \
	$< > $@.tmp && $(MV) $@.tmp $@ \
	$(NULL)

.service.in.service:
	$(SUBST_RULE)
.socket.in.socket:
	$(SUBST_RULE)

# Webpack related
include pkg/build

# required for running unit and integration tests; commander and ws are deps of chrome-remote-interface
WEBPACK_TEST_DEPS = \
	node_modules/chrome-remote-interface \
	node_modules/commander \
	node_modules/sizzle \
	node_modules/ws \
	$(NULL)

# the rules above copy a lot of stuff into builddir; clean it up so that distcleancheck works
clean-local::
	$(AM_V_at)test "$(srcdir)" == "$(builddir)" || rm -rf dist/

install-data-local:: $(WEBPACK_INSTALL) $(MANIFESTS)
	$(MKDIR_P) $(DESTDIR)$(pkgdatadir)
	$(V_TAR) tar --format=posix -cf - $^ | tar --no-same-owner -C $(DESTDIR)$(pkgdatadir) --strip-components=1 -xvf -
install-data-local:: $(WEBPACK_GZ_INSTALL)
	@for file in $^; do \
		target="$(DESTDIR)$(pkgdatadir)/$${file##*dist/}.gz"; \
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

#

ACLOCAL_AMFLAGS = -I tools ${ACLOCAL_FLAGS}

DISTCHECK_CONFIGURE_FLAGS=						        \
	--disable-debug \
	--disable-coverage \
	--disable-silent-rules \
	--enable-prefix-only \
	$(NULL)

AM_CPPFLAGS = \
	-I$(top_builddir) \
	-I$(top_builddir)/src \
	-I$(top_srcdir) \
	-I$(top_srcdir)/src \
	-DSRCDIR=\"$(abs_srcdir)\" \
	-DBUILDDIR=\"$(abs_builddir)\" \
	-DDATADIR=\"$(datadir)\" \
	-DLIBEXECDIR=\""$(libexecdir)"\" \
	-DPACKAGE_SYSCONF_DIR=\""$(sysconfdir)"\" \
	-DPACKAGE_BIN_DIR=\""$(bindir)"\" \
	-DPACKAGE_LIB_DIR=\""$(libdir)"\" \
	-D_POSIX_PTHREAD_SEMANTICS -D_REENTRANT \
	$(NULL)

AM_LDFLAGS = -Wl,--as-needed

LOG_DRIVER = $(PYTHON) $(top_srcdir)/tools/tap-driver
LOG_COMPILER = sh -c 'timeout 300 "$$0" "$$@" --tap' # For GLib < 2.62

TEST_EXTENSIONS = .html .sh
SH_LOG_DRIVER = $(LOG_DRIVER)
HTML_LOG_DRIVER = $(LOG_DRIVER)
HTML_TEST_SERVER = $(builddir)/test-server

HTML_LOG_COMPILER = timeout 60 $(PYTHON) $(top_srcdir)/test/common/tap-cdp --strip=$(abs_top_srcdir)/ -- $(HTML_TEST_SERVER)

VALGRIND_ARGS = --trace-children=yes --quiet --error-exitcode=33 \
	--suppressions=valgrind-suppressions --gen-suppressions=all \
	--num-callers=16 --leak-check=yes --show-leak-kinds=definite \
	--errors-for-leak-kinds=definite --trace-children-skip='*mock*,/bin*,/usr/bin/*,/usr/local/bin'
VALGRIND_SUPPRESSIONS = \
	tools/glib.supp \
	tools/libssh.supp \
	tools/polkit.supp \
	tools/gnutls.supp \
	$(NULL)

if VALGRIND_MINADDR_HACK
VALGRIND_ARGS += --aspace-minaddr=0x100000000
endif

valgrind-suppressions: $(VALGRIND_SUPPRESSIONS)
	$(AM_V_GEN) cat $^ /usr/share/glib-2.0/valgrind/glib.supp > $@

check-memory: valgrind-suppressions
	$(MAKE) LOG_FLAGS="valgrind $(VALGRIND_ARGS)" \
	        HTML_LOG_FLAGS="valgrind $(VALGRIND_ARGS)" \
		COCKPIT_SKIP_SLOW_TESTS=1 \
		$(AM_MAKEFLAGS) check TESTS="$(filter-out tools/% bots/%,$(TESTS))"
recheck-memory: valgrind-suppressions
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
	$(MKDIR_P) $(DESTDIR)$(htmldir)
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

dist-hook::
if ENABLE_DOC
	@true
else
	@echo "*** doc must be enabled (ie: --enable-doc) in order to make dist or distcheck"
	@false
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
	$(MV) $@.tmp $@

# This is the stock rule with $(BUILT_SOURCES) dependency removed.
# In the future, we can do this via "no-dist-built-sources" automake option:
# https://git.savannah.gnu.org/cgit/automake.git/commit/?id=13659a7385
distdir:
	$(MAKE) $(AM_MAKEFLAGS) distdir-am

# Build up the distribution using $COMMITTED_DIST and include node_modules licenses
# also automatically update minimum base dependency in RPM spec file
dist-hook:: $(MANIFESTS)
	( cd $(srcdir); git ls-tree HEAD --name-only -r $(COMMITTED_DIST) || (echo $(COMMITTED_DIST) | tr ' ' '\n' ) ) | \
		tar --format=posix -C $(srcdir) --exclude test/reference -cf - -T - | tar -C $(distdir) -xf -
	echo $(VERSION) > $(distdir)/.tarball
	[ ! -e $(distdir)/tools/cockpit.spec ] || $(srcdir)/tools/gen-spec-dependencies $(distdir)/tools/cockpit.spec

distcheck-hook::
	$(srcdir)/tools/check-dist $(distdir)

# checkout Cockpit's bots for standard test VM images and API to launch them
# must be from main, as only that has current and existing images; but testvm.py API is stable
# support CI testing against a bots change
bots:
	tools/make-bots

multi-word: po/cockpit.pot
	msggrep --no-wrap --msgid -e '\S\+\s' po/cockpit.pot | grep "^msgid " | cut -d " " -f2- | sort --reverse > titles

title2sentence: multi-word
	tools/title2sentence.py -i titles -o t2s.sh

include po/Makefile.am
include pkg/Makefile.am
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
include src/common/Makefile-common.am
include src/websocket/Makefile-websocket.am
include tools/Makefile-tools.am
include src/ssh/Makefile-ssh.am
include src/ws/Makefile-ws.am
include src/tls/Makefile-tls.am
include src/retest/Makefile.am
include src/pam-ssh-add/Makefile.am
include containers/Makefile.am
include doc/Makefile-doc.am
include doc/guide/Makefile-guide.am
include doc/man/Makefile-man.am
