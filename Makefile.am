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

DISTCLEANFILES = \
	$(srcdir)/Makefile \
	node_modules \
	cockpit-cache-*.tar.xz \
	$(NULL)

EXTRA_DIST = \
	package.json \
	README.md \
	$(NULL)

clean-local::
	find $(builddir) -name '*.gc??' -delete
	find $(srcdir) -name '*.pyc' -delete

SUFFIXES = \
	.css .css.gz \
	.html .html.gz \
	.js .js.gz \
	.json .json.in \
	.jsx \
	.map .map.gz \
	.mo .po \
	.service .service.in \
	.socket .socket.in \
	.svg .svg.gz \
	.woff .woff.gz \
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

UGLIFY_JS = $(srcdir)/node_modules/.bin/uglifyjs

CLEAN_CSS = $(srcdir)/node_modules/.bin/cleancss

MIN_JS_RULE = \
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/tools/missing $(UGLIFY_JS) $(filter-out %.deps, $^) --mangle --comments 'preserve' --beautify \
		--source-map $@.map --source-map-url $(notdir $@).map --source-map-include-sources > $@.tmp && \
	$(MV) $@.tmp $@

MIN_CSS_RULE = \
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/tools/missing $(CLEAN_CSS) --keep-line-breaks --output=$@ \
		--source-map --source-map-inline-sources $^

JSHINT_RULE = \
	$(V_CHECK) $(srcdir)/tools/missing $(srcdir)/tools/jshint $<

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
	-e 's,[@]PKEXEC[@],$(PKEXEC),g' \
	-e 's,[@]SUDO[@],$(SUDO),g' \
	-e 's,[@]user[@],$(COCKPIT_USER),g' \
	-e 's,[@]group[@],$(COCKPIT_GROUP),g' \
	-e 's,[@]selinux_config_type[@],$(COCKPIT_SELINUX_CONFIG_TYPE),g' \
	-e 's,[@]with_networkmanager_needs_root[@],$(with_networkmanager_needs_root),g' \
	-e 's,[@]with_storaged_iscsi_sessions[@],$(with_storaged_iscsi_sessions),g' \
	-e 's,[@]with_appstream_config_packages[@],$(with_appstream_config_packages),g' \
	-e 's,[@]with_appstream_data_packages[@],$(with_appstream_data_packages),g' \
	-e 's,[@]with_nfs_client_package[@],$(with_nfs_client_package),g' \
	-e 's,[@]with_vdo_package[@],$(with_vdo_package),g' \
	$< > $@.tmp && $(MV) $@.tmp $@ \
	$(NULL)

.css.css.gz:
	$(GZ_RULE)
.html.html.gz:
	$(GZ_RULE)
.js.js.gz:
	$(GZ_RULE)
.json.in.json:
	$(SUBST_RULE)
.map.map.gz:
	$(GZ_RULE)
.service.in.service:
	$(SUBST_RULE)
.socket.in.socket:
	$(SUBST_RULE)
.svg.svg.gz:
	$(GZ_RULE)
.woff.woff.gz:
	$(GZ_RULE)

# Webpack related

WEBPACK_PACKAGES = \
	apps \
	dashboard \
	docker \
	kdump \
	kubernetes \
	machines \
	networkmanager \
	ovirt \
	pcp \
	packagekit \
	playground \
	realmd \
	selinux \
	shell \
	sosreport \
	ssh \
	storaged \
	subscriptions \
	systemd \
	tuned \
	users \
	$(NULL)

V_WEBPACK = $(V_WEBPACK_$(V))
V_WEBPACK_ = $(V_WEBPACK_$(AM_DEFAULT_VERBOSITY))
V_WEBPACK_0 = @echo "  WEBPACK  $(@:dist/%/stamp=%)";

WEBPACK_MAKE = NODE_ENV=$(NODE_ENV) SRCDIR=$(abspath $(srcdir)) BUILDDIR=$(builddir) \
	       $(srcdir)/tools/missing $(srcdir)/tools/webpack-make

WEBPACK_CONFIG = $(srcdir)/webpack.config.js
WEBPACK_INPUTS =
WEBPACK_PO =
WEBPACK_OUTPUTS =
WEBPACK_INSTALL = $(WEBPACK_PACKAGES:%=dist/%/manifest.json)
WEBPACK_DEPS = $(WEBPACK_PACKAGES:%=dist/%/Makefile.deps)
WEBPACK_STAMPS = $(WEBPACK_PACKAGES:%=dist/%/stamp)
WEBPACK_MANIFEST_IN = $(WEBPACK_PACKAGES:%=pkg/%/manifest.json.in)

noinst_SCRIPTS += $(WEBPACK_STAMPS) $(WEBPACK_INSTALL)
CLEANFILES += $(WEBPACK_STAMPS) $(WEBPACK_DEPS) $(WEBPACK_OUTPUTS)
EXTRA_DIST += $(WEBPACK_STAMPS) $(WEBPACK_DEPS) $(WEBPACK_MANIFEST_IN) webpack.config.js

PRINT_COPY_MSG_0 = echo "  COPY    " $@ &&
PRINT_COPY_MSG_ = $(PRINT_COPY_MSG_$(AM_DEFAULT_VERBOSITY))

# Copy an original copy of each Makefile.deps from the srcdir, in case
# of an out-of-tree build from a tarball.  This is needed because the
# 'include' below won't find the file in srcdir.
# This rule needs to have a successful exit, or make will become unhappy.
dist/%/Makefile.deps:
	$(AM_V_at)test "$(srcdir)" == "$(builddir)" -o ! $(srcdir)/$@ -nt $@ || ( \
	  $(PRINT_COPY_MSG_$(V))$(MKDIR_P) $(dir $@) && \
	  cp -p $(srcdir)/$@ $@.tmp && \
	  mv $@.tmp $@)

# This is the primary rule for running webpack
dist/%/stamp: $(WEBPACK_CONFIG) $(srcdir)/tools/webpack-make
	$(V_WEBPACK) $(MKDIR_P) dist/$* && \
	  $(WEBPACK_MAKE) -d dist/$*/Makefile.deps $(WEBPACK_CONFIG) && \
	  touch $@

dist/%/manifest.json: pkg/%/manifest.json
	$(COPY_RULE)

-include $(WEBPACK_DEPS)

distclean-local::
	rm -rf dist/
install-data-local:: $(WEBPACK_INSTALL)
	$(MKDIR_P) $(DESTDIR)$(pkgdatadir)
	tar -cf - $^ | tar -C $(DESTDIR)$(pkgdatadir) --strip-components=1 -xvf -
install-data-local:: $(WEBPACK_DEBUG)
	$(MKDIR_P) $(DESTDIR)$(debugdir)$(pkgdatadir)
	tar -cf - $^ | tar -C $(DESTDIR)$(debugdir)$(pkgdatadir) --strip-components=1 -xvf -
uninstall-local::
	find $(DESTDIR)$(pkgdatadir) -ignore_readdir_race -type f -exec rm -f {} \;
	find $(DESTDIR)$(pkgdatadir) -ignore_readdir_race -type d -empty -delete
	find $(DESTDIR)$(debugdir)$(pkgdatadir) -ignore_readdir_race -type f -delete
	find $(DESTDIR)$(debugdir)$(pkgdatadir) -ignore_readdir_race -type d -empty -delete
dist-hook:: $(WEBPACK_INPUTS) $(WEBPACK_OUTPUTS) $(WEBPACK_PO)
	tar -cf - $^ | tar -C $(distdir) -xf -

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
	-DPACKAGE_LIBEXEC_DIR=\""$(libexecdir)"\" \
	-DPACKAGE_SYSCONF_DIR=\""$(sysconfdir)"\" \
	-DPACKAGE_BIN_DIR=\""$(bindir)"\" \
	-DPACKAGE_LOCALSTATE_DIR=\""$(localstatedir)/lib/cockpit"\" \
	-DPACKAGE_LIB_DIR=\""$(libdir)"\" \
	-D_POSIX_PTHREAD_SEMANTICS -D_REENTRANT \
	$(NULL)

AM_LDFLAGS = -Wl,--as-needed

LOG_DRIVER = $(PYTHON) $(top_srcdir)/tools/tap-driver
LOG_COMPILER = $(PYTHON) $(top_srcdir)/tools/tap-gtester

TEST_EXTENSIONS = .html .sh
SH_LOG_DRIVER = $(LOG_DRIVER)
HTML_LOG_DRIVER = $(LOG_DRIVER)
HTML_TEST_SERVER = $(builddir)/test-server

HTML_LOG_COMPILER = $(PYTHON) $(top_srcdir)/test/common/tap-cdp --strip=$(top_srcdir)/ -- $(HTML_TEST_SERVER)

VALGRIND_ARGS = --trace-children=yes --quiet --error-exitcode=33 \
	--suppressions=valgrind-suppressions --gen-suppressions=all \
	--num-callers=16 --leak-check=yes --show-leak-kinds=definite \
	--errors-for-leak-kinds=definite --trace-children-skip='*mock*,/bin*,/usr/bin/*,/usr/local/bin'
VALGRIND_SUPPRESSIONS = \
	tools/gcrypt.supp \
	tools/glib.supp \
	tools/pthread.supp \
	tools/travis.supp \
	tools/polkit.supp \
	tools/pcp.supp \
	tools/unknown.supp \
	tools/zlib.supp \
	tools/libssh.supp \
	tools/json-glib.supp \
	$(NULL)

valgrind-suppressions: $(VALGRIND_SUPPRESSIONS)
	$(AM_V_GEN) cat $^ > $@

check-memory: valgrind-suppressions
	$(MAKE) LOG_FLAGS="-- valgrind $(VALGRIND_ARGS)" \
	        HTML_LOG_FLAGS="valgrind $(VALGRIND_ARGS)" \
		$(AM_MAKEFLAGS) check TESTS="$(filter-out tools/% bots/%,$(TESTS))"
recheck-memory: valgrind-suppressions
	$(MAKE) LOG_FLAGS="-- valgrind $(VALGRIND_ARGS)" \
	        HTML_LOG_FLAGS="valgrind $(VALGRIND_ARGS)" \
		$(AM_MAKEFLAGS) recheck

install-data-hook::
	mkdir -p $(DESTDIR)$(localstatedir)/lib/cockpit
	chgrp wheel $(DESTDIR)$(localstatedir)/lib/cockpit || true
	chmod 775 $(DESTDIR)$(localstatedir)/lib/cockpit

# Fonts are used by multiple things so put them here
OPENSANS_FONTS = \
	dist/fonts/OpenSans-Bold-webfont.woff \
	dist/fonts/OpenSans-BoldItalic-webfont.woff \
	dist/fonts/OpenSans-ExtraBold-webfont.woff  \
	dist/fonts/OpenSans-ExtraBoldItalic-webfont.woff \
	dist/fonts/OpenSans-Italic-webfont.woff \
	dist/fonts/OpenSans-Light-webfont.woff \
	dist/fonts/OpenSans-LightItalic-webfont.woff \
	dist/fonts/OpenSans-Regular-webfont.woff \
	dist/fonts/OpenSans-Semibold-webfont.woff \
	dist/fonts/OpenSans-SemiboldItalic-webfont.woff \
	$(NULL)

dist/fonts/%.woff:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp -L $(subst dist/fonts,$(srcdir)/node_modules/patternfly/dist/fonts,$@) $@.tmp && $(MV) $@.tmp $@

EXTRA_DIST += $(OPENSANS_FONTS)

CLEANFILES += $(OPENSANS_FONTS)

if ENABLE_DOC

include doc/Makefile-doc.am
include doc/guide/Makefile-guide.am
include doc/man/Makefile-man.am

dist-doc-hook:
	@true

else

dist-doc-hook:
	@echo "*** doc must be enabled (ie: --enable-doc) in order to make dist or distcheck"

endif

dist-hook:: dist-doc-hook
	@true
distcheck-hook:: dist-doc-hook
	@true
install-data-local:: dist/guide/html/index.html
	$(MKDIR_P) $(DESTDIR)$(htmldir)
	$(INSTALL_DATA) $(dir $<)/* $(DESTDIR)$(htmldir)
uninstall-local::
	rm -rf $(DESTDIR)$(htmldir)

# See bots/make-source
dump-dist-gzip:
	@echo "$(abs_builddir)/$(distdir).tar.gz"

# Subdirectories to distribute everything that's committed to git
COMMITTED_DIST = \
	tools/ \
	test/common \
	$(NULL)

# Build up the distribution using $COMMITTED_DIST and include node_modules licenses
# also automatically update minimum base dependency in RPM spec file
dist-hook:: $(WEBPACK_PACKAGES:%=dist/%/manifest.json)
	( cd $(srcdir); git ls-tree HEAD --name-only -r $(COMMITTED_DIST) || (echo $(COMMITTED_DIST) | tr ' ' '\n' ) ) | \
		tar -C $(srcdir) -cf - -T - | tar -C $(distdir) -xf -
	echo $(VERSION) > $(distdir)/.tarball
	$(srcdir)/tools/build-copying $(distdir)/node_modules > $(distdir)/COPYING.node
	[ ! -d $(distdir)/tools/debian ] || $(srcdir)/tools/build-debian-copyright $(distdir)/node_modules > $(distdir)/tools/debian/copyright
	[ ! -e $(distdir)/tools/cockpit.spec ] || $(srcdir)/tools/gen-spec-dependencies $(distdir)/tools/cockpit.spec

DIST_TAR_MAIN = tar --format=posix -cf - "$(distdir)"
DIST_TAR_CACHE = tar --format=posix -cf - --transform="flags=r;s|^\./||" --transform="flags=r;s|^|$(distdir)/|" \
	"$(srcdir)/node_modules" "$(srcdir)/package.json"

DIST_ARCHIVES = \
	cockpit-$(VERSION).tar.xz \
	cockpit-cache-$(VERSION).tar.xz

dist-gzip: distdir
	$(DIST_TAR_MAIN) | GZIP=$(GZIP_ENV) gzip -c > $(distdir).tar.gz
	$(DIST_TAR_CACHE) | GZIP=$(GZIP_ENV) gzip -c > cockpit-cache-$(VERSION).tar.gz
	find "$(distdir)" -type d ! -perm -200 -exec chmod u+w {} ';' && rm -rf "$(distdir)"
dist-xz: distdir
	$(DIST_TAR_MAIN) | xz -ec > $(distdir).tar.xz
	$(DIST_TAR_CACHE) | xz -ec > cockpit-cache-$(VERSION).tar.xz
	find "$(distdir)" -type d ! -perm -200 -exec chmod u+w {} ';' && rm -rf "$(distdir)"

distcheck-hook::
	$(srcdir)/tools/check-dist $(distdir)

include po/Makefile.am
include pkg/Makefile.am
include src/base1/Makefile.am
include src/branding/centos/Makefile.am
include src/branding/debian/Makefile.am
include src/branding/default/Makefile.am
include src/branding/fedora/Makefile.am
include src/branding/kubernetes/Makefile.am
include src/branding/registry/Makefile.am
include src/branding/rhel/Makefile.am
include src/branding/ubuntu/Makefile.am
include src/bridge/Makefile.am
include src/common/Makefile-common.am
include src/websocket/Makefile-websocket.am
include tools/Makefile-tools.am
include src/ssh/Makefile-ssh.am
include src/ws/Makefile-ws.am
include src/retest/Makefile.am
include src/pam-ssh-add/Makefile.am
include containers/Makefile.am
