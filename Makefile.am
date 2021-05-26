export PATH := $(PATH):$(abs_srcdir)/node_modules/.bin

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
	.css .css.gz \
	.html .html.gz \
	.js .js.gz \
	.jsx \
	.map .map.gz \
	.mo .po \
	.service .service.in \
	.socket .socket.in \
	.svg .svg.gz \
	.1 .8 .5 \
	$(NULL)

V_CHECK = $(V_CHECK_$(V))
V_CHECK_ = $(V_CHECK_$(AM_DEFAULT_VERBOSITY))
V_CHECK_0 = @echo "  CHECK   " $@;

V_GZIP = $(V_GZIP_$(V))
V_GZIP_ = $(V_GZIP_$(AM_DEFAULT_VERBOSITY))
V_GZIP_0 = @echo "  GZIP    " $@;

V_COPY = $(V_COPY_$(V))
V_COPY_ = $(V_COPY_$(AM_DEFAULT_VERBOSITY))
V_COPY_0 = @echo "  COPY    " $@;

V_TAR = $(V_TAR_$(V))
V_TAR_ = $(V_TAR_$(AM_DEFAULT_VERBOSITY))
V_TAR_0 = @echo "  TAR     " $@;

MV = mv -f

COPY_RULE = \
        $(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp -L $< $@.tmp && $(MV) $@.tmp $@

CAT_RULE = \
        $(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	cat $^ > $@.tmp && $(MV) $@.tmp $@

GZ_RULE = \
	$(V_GZIP) $(MKDIR_P) $(dir $@) && \
	gzip -n -c $< > $@.tmp && $(MV) $@.tmp $@

SUBST_RULE = \
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && sed \
	-e 's,[@]datadir[@],$(datadir),g' \
	-e 's,[@]libexecdir[@],$(libexecdir),g' \
	-e 's,[@]sysconfdir[@],$(sysconfdir),g' \
	-e 's,[@]libdir[@],$(libdir),g' \
	-e 's,[@]includedir[@],$(includedir),g' \
	-e 's,[@]bindir[@],$(bindir),g' \
	-e 's,[@]sbindir[@],$(sbindir),g' \
	-e 's,[@]prefix[@],$(prefix),g' \
	-e 's,[@]exec_prefix[@],$(exec_prefix),g' \
	-e 's,[@]prefix[@],$(prefix),g' \
	-e 's,[@]PACKAGE[@],$(PACKAGE),g' \
	-e 's,[@]VERSION[@],$(VERSION),g' \
	-e 's,[@]user[@],$(COCKPIT_USER),g' \
	-e 's,[@]group[@],$(COCKPIT_GROUP),g' \
	-e 's,[@]wsinstanceuser[@],$(COCKPIT_WSINSTANCE_USER),g' \
	-e 's,[@]wsinstancegroup[@],$(COCKPIT_WSINSTANCE_GROUP),g' \
	-e 's,[@]admin_group[@],$(admin_group),g' \
	-e 's,[@]selinux_config_type[@],$(COCKPIT_SELINUX_CONFIG_TYPE),g' \
	$< > $@.tmp && $(MV) $@.tmp $@ \
	$(NULL)

.css.css.gz:
	$(GZ_RULE)
.html.html.gz:
	$(GZ_RULE)
.js.js.gz:
	$(GZ_RULE)
.map.map.gz:
	$(GZ_RULE)
.service.in.service:
	$(SUBST_RULE)
.socket.in.socket:
	$(SUBST_RULE)
.svg.svg.gz:
	$(GZ_RULE)

# Webpack related

WEBPACK_PACKAGES = \
	base1 \
	apps \
	kdump \
	metrics \
	networkmanager \
	packagekit \
	playground \
	selinux \
	shell \
	sosreport \
	static \
	storaged \
	systemd \
	tuned \
	users \
	$(NULL)

MANIFESTS = \
	pkg/pcp/manifest.json \
	pkg/ssh/manifest.json \
	$(NULL)

MANIFESTS += $(WEBPACK_PACKAGES:%=dist/%/manifest.json)

V_WEBPACK = $(V_WEBPACK_$(V))
V_WEBPACK_ = $(V_WEBPACK_$(AM_DEFAULT_VERBOSITY))
V_WEBPACK_0 = @echo "  WEBPACK  $(@:dist/%/manifest.json=%)";

WEBPACK_MAKE = NODE_ENV=$(NODE_ENV) SRCDIR=$(abspath $(srcdir)) BUILDDIR=$(abspath $(builddir)) \
	       timeout 15m $(srcdir)/tools/missing $(srcdir)/tools/webpack-make

WEBPACK_CONFIG = $(srcdir)/webpack.config.js
WEBPACK_INPUTS =
WEBPACK_OUTPUTS =
WEBPACK_INSTALL =
WEBPACK_DEPS = $(WEBPACK_PACKAGES:%=$(top_srcdir)/dist/%/Makefile.deps)

# required for running unit and integration tests; commander and ws are deps of chrome-remote-interface
WEBPACK_TEST_DEPS = \
	node_modules/chrome-remote-interface \
	node_modules/commander \
	node_modules/sizzle \
	node_modules/ws \
	$(NULL)

noinst_SCRIPTS += $(MANIFESTS)
EXTRA_DIST += $(MANIFESTS) $(WEBPACK_DEPS) webpack.config.js

# Nothing generates this directly, but it's included as a dependency in
# various places.  It will automatically appear as part of the webpack
# build.
dist/%/Makefile.deps:
	@true

dist/%/manifest.json: $(WEBPACK_CONFIG) $(srcdir)/tools/webpack-make $(srcdir)/package-lock.json
	$(V_WEBPACK) $(WEBPACK_MAKE) -d dist/$*/Makefile.deps -c $(WEBPACK_CONFIG)

-include $(WEBPACK_DEPS)

# the rules above copy a lot of stuff into builddir; clean it up so that distcleancheck works
clean-local::
	$(AM_V_at)test "$(srcdir)" == "$(builddir)" || rm -rf dist/

V_NODE_MODULES = $(V_NODE_MODULES_$(V))
V_NODE_MODULES_ = $(V_NODE_MODULES_$(AM_DEFAULT_VERBOSITY))
V_NODE_MODULES_0 = @V=0

# We want tools/node-modules to run every time package-lock.json is requested
# See https://www.gnu.org/software/make/manual/html_node/Force-Targets.html
FORCE:
package-lock.json: FORCE
	$(V_NODE_MODULES) $(top_srcdir)/tools/node-modules make_package_lock_json

install-data-local:: $(WEBPACK_INSTALL) $(MANIFESTS)
	$(MKDIR_P) $(DESTDIR)$(pkgdatadir)
	$(V_TAR) tar --format=posix -cf - $^ | tar --no-same-owner -C $(DESTDIR)$(pkgdatadir) --strip-components=1 -xvf -
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
	$(srcdir)/tools/build-copying $(distdir) > $(distdir)/COPYING.node

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

dist-doc-hook:
	@true

dist-hook:: dist-doc-hook
	@true
distcheck-hook:: dist-doc-hook
	@true
install-data-local:: dist/guide/html/index.html
	$(MKDIR_P) $(DESTDIR)$(htmldir)
	$(INSTALL_DATA) $(dir $<)/* $(DESTDIR)$(htmldir)
uninstall-local::
	rm -rf $(DESTDIR)$(htmldir)

else

dist-doc-hook:
	@echo "*** doc must be enabled (ie: --enable-doc) in order to make dist or distcheck"

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
	$(AM_V_GEN) $(srcdir)/tools/build-debian-copyright > $@.tmp
	$(MV) $@.tmp $@

# Build up the distribution using $COMMITTED_DIST and include node_modules licenses
# also automatically update minimum base dependency in RPM spec file
dist-hook:: $(MANIFESTS)
	( cd $(srcdir); git ls-tree HEAD --name-only -r $(COMMITTED_DIST) || (echo $(COMMITTED_DIST) | tr ' ' '\n' ) ) | \
		tar --format=posix -C $(srcdir) -cf - -T - | tar -C $(distdir) -xf -
	echo $(VERSION) > $(distdir)/.tarball
	[ ! -e $(distdir)/tools/cockpit.spec ] || $(srcdir)/tools/gen-spec-dependencies $(distdir)/tools/cockpit.spec

distcheck-hook::
	$(srcdir)/tools/check-dist $(distdir)

# checkout Cockpit's bots for standard test VM images and API to launch them
# must be from master, as only that has current and existing images; but testvm.py API is stable
# support CI testing against a bots change
bots:
	tools/make-bots

multi-word: po/cockpit.pot
	$(MSGGREP) --no-wrap --msgid -e '\S\+\s' po/cockpit.pot | grep "^msgid " | cut -d " " -f2- | sort --reverse > titles

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
