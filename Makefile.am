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

TESTS =

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
	.bowerrc \
	bower.json \
	package.json \
	src/branding \
	README.md \
	$(NULL)

clean-local:
	find $(builddir) -name '*.gc??' -delete
	find $(srcdir) -name '*.pyc' -delete
	find $(builddir)/dist -mindepth 1 -name README.md -prune -o -print | xargs rm -rf

SUFFIXES = .css .css.gz .html .html.gz .js .js.gz .jsx .map .map.gz .mo .po .svg .svg.gz .woff .woff.gz .1 .8 .5

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

GZ_RULE = \
	$(V_GZIP) $(MKDIR_P) $(dir $@) && \
	gzip -n -c $< > $@.tmp && $(MV) $@.tmp $@

.css.css.gz:
	$(GZ_RULE)
.html.html.gz:
	$(GZ_RULE)
.js.js.gz:
	$(GZ_RULE)
.map.map.gz:
	$(GZ_RULE)
.svg.svg.gz:
	$(GZ_RULE)
.woff.woff.gz:
	$(GZ_RULE)

# Webpack related

V_WEBPACK = $(V_WEBPACK_$(V))
V_WEBPACK_ = $(V_WEBPACK_$(AM_DEFAULT_VERBOSITY))
V_WEBPACK_0 = @echo "  WEBPACK  $(@:dist/Makefile-%.deps=%)";

WEBPACK_CONFIG = $(srcdir)/webpack.config.js
WEBPACK_INPUTS =
WEBPACK_OUTPUTS =
WEBPACK_INSTALL =

WEBPACK_DEPS = \
	dist/Makefile-dashboard.deps \
	dist/Makefile-docker.deps \
	dist/Makefile-kubernetes.deps \
	dist/Makefile-machines.deps \
	dist/Makefile-networkmanager.deps \
	dist/Makefile-ostree.deps \
	dist/Makefile-playground.deps \
	dist/Makefile-realmd.deps \
	dist/Makefile-selinux.deps \
	dist/Makefile-shell.deps \
	dist/Makefile-sosreport.deps \
	dist/Makefile-storaged.deps \
	dist/Makefile-subscriptions.deps \
	dist/Makefile-systemd.deps \
	dist/Makefile-tuned.deps \
	dist/Makefile-users.deps \
	$(NULL)

noinst_SCRIPTS += $(WEBPACK_DEPS) $(WEBPACK_INSTALL)
CLEANFILES += $(WEBPACK_DEPS) $(WEBPACK_OUTPUTS)
EXTRA_DIST += $(WEBPACK_DEPS) webpack.config.js

# Run webpack if we don't have the include file or if its out of date
# If we have distributed a copy in a tarball, copy that into place
dist/Makefile-%.deps: $(WEBPACK_CONFIG)
	$(AM_V_GEN) if test $(srcdir)/dist/$(notdir $@) -nt $(WEBPACK_CONFIG); \
	then $(MKDIR_P) $(dir $@) && cp -p $(srcdir)/dist/$(notdir $@) $@.tmp && $(MV) $@.tmp $@; \
	else $(WEBPACK_MAKE) -d $@ $<; fi

-include dist/Makefile-dashboard.deps
-include dist/Makefile-docker.deps
-include dist/Makefile-kubernetes.deps
-include dist/Makefile-machines.deps
-include dist/Makefile-networkmanager.deps
-include dist/Makefile-ostree.deps
-include dist/Makefile-playground.deps
-include dist/Makefile-realmd.deps
-include dist/Makefile-selinux.deps
-include dist/Makefile-shell.deps
-include dist/Makefile-sosreport.deps
-include dist/Makefile-storaged.deps
-include dist/Makefile-subscriptions.deps
-include dist/Makefile-systemd.deps
-include dist/Makefile-tuned.deps
-include dist/Makefile-users.deps

WEBPACK_MAKE = NODE_ENV=$(NODE_ENV) SRCDIR=$(srcdir) BUILDDIR=$(builddir) \
	       $(srcdir)/tools/missing $(srcdir)/tools/webpack-make
WEBPACK_RULE = $(V_WEBPACK) $(WEBPACK_MAKE)

all-local:: $(WEBPACK_DEPS) $(WEBPACK_OUTPUTS) $(WEBPACK_INSTALL)
	@true
distclean-local::
	rm -rf dist/
install-data-local:: $(WEBPACK_INSTALL)
	tar -cf - $^ | tar -C $(DESTDIR)$(pkgdatadir) --strip-components=1 -xvf -
	$(SED_SUBST) -i $(DESTDIR)$(pkgdatadir)/*/manifest.json
install-data-local:: $(WEBPACK_DEBUG)
	tar -cf - $^ | tar -C $(DESTDIR)$(debugdir)$(pkgdatadir) --strip-components=1 -xvf -
uninstall-local::
	find $(DESTDIR)$(pkgdatadir) -type f -delete
	find $(DESTDIR)$(pkgdatadir) -type d -empty -delete
	find $(DESTDIR)$(debugdir)$(pkgdatadir) -type f -delete
	find $(DESTDIR)$(debugdir)$(pkgdatadir) -type d -empty -delete
dist-hook:: $(WEBPACK_INPUTS) $(WEBPACK_OUTPUTS)
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

LOG_DRIVER = $(top_srcdir)/tools/tap-driver
LOG_COMPILER = $(top_srcdir)/tools/tap-gtester

TEST_EXTENSIONS = .html .sh
SH_LOG_DRIVER = $(top_srcdir)/tools/tap-driver
HTML_LOG_DRIVER = $(top_srcdir)/tools/tap-driver
HTML_TEST_SERVER = $(builddir)/test-server
if WITH_PHANTOMJS
HTML_LOG_COMPILER = $(top_srcdir)/tools/tap-phantom --strip=$(top_srcdir)/ -- $(HTML_TEST_SERVER)
else
HTML_LOG_DRIVER_FLAGS = --missing=phantomjs
endif

VALGRIND_ARGS = --trace-children=yes --quiet --error-exitcode=33 \
	--suppressions=valgrind-suppressions --gen-suppressions=all \
	--num-callers=16 --leak-check=yes --show-leak-kinds=definite \
	--errors-for-leak-kinds=definite --trace-children-skip='*mock*,/bin*,/usr/bin/*,/usr/local/bin,*cockpit-bridge,*cockpit-stub'
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
	$(NULL)

valgrind-suppressions: $(VALGRIND_SUPPRESSIONS)
	$(AM_V_GEN) cat $^ > $@

check-memory: valgrind-suppressions
	$(MAKE) LOG_FLAGS="-- valgrind $(VALGRIND_ARGS)" \
	        HTML_LOG_FLAGS="valgrind $(VALGRIND_ARGS)" \
		$(AM_MAKEFLAGS) check
recheck-memory: valgrind-suppressions
	$(MAKE) LOG_FLAGS="-- valgrind $(VALGRIND_ARGS)" \
	        HTML_LOG_FLAGS="valgrind $(VALGRIND_ARGS)" \
		$(AM_MAKEFLAGS) recheck

SED_SUBST = sed \
        -e 's,[@]datadir[@],$(datadir),g' \
        -e 's,[@]libexecdir[@],$(libexecdir),g' \
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
        -e 's,[@]selinux_config_type[@],$(COCKPIT_SELINUX_CONFIG_TYPE),g' \
        $(NULL)

UGLIFY_JS = $(srcdir)/node_modules/.bin/uglifyjs

testassetsdir = $(datadir)/cockpit-test-assets
testassets_programs =
testassets_data =
testassets_systemdunit_data =

install-test-assets: $(testassets_programs) $(testassets_data) $(testassets_systemdunit_data)
	$(MKDIR_P) $(DESTDIR)$(testassetsdir)
	$(MKDIR_P) $(DESTDIR)$(systemdunitdir)
	for p in $(testassets_programs); do \
          $(INSTALL_PROGRAM) $$p $(DESTDIR)$(testassetsdir); \
        done
	cd $(srcdir); for d in $(testassets_data); do $(INSTALL_DATA) -D $$d $(DESTDIR)$(testassetsdir)/$$d; done
	for d in $(testassets_systemdunit_data); do $(INSTALL_DATA) $$d $(DESTDIR)$(systemdunitdir); done

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
	cp -L $(subst dist/fonts,$(BOWER)/patternfly/dist/fonts,$@) $@.tmp && $(MV) $@.tmp $@

EXTRA_DIST += $(OPENSANS_FONTS)

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

# See tools/make-source
dump-dist-gzip:
	@echo "$(abs_builddir)/$(distdir).tar.gz"

# Subdirectories to distribute everything that's committed to git
COMMITTED_DIST = \
	pkg/ \
	tools/ \
	test/ \
	$(NULL)

# Build up the distribution using $COMMITTED_DIST and include node_modules and bower licenses
dist-hook::
	( cd $(srcdir); git ls-tree HEAD --name-only -r $(COMMITTED_DIST) || (echo $(COMMITTED_DIST) | tr ' ' '\n' ) ) | \
		tar -C $(srcdir) -cf - -T - | tar -C $(distdir) -xf -
	tar -C $(srcdir) -cf - --exclude='phantomjs*' node_modules/ | tar -C $(distdir) -xf -
	tar -C $(srcdir) -cf - bower_components/ | tar -C $(distdir) -xf -
	echo $(VERSION) > $(distdir)/.tarball
	$(srcdir)/tools/build-copying $(BOWER) > $(distdir)/COPYING.bower

DIST_TAR_MAIN = tar --format=posix -cf - --exclude='node_modules' --exclude='bower_components' "$(distdir)"
DIST_TAR_CACHE = tar --format=posix -cf - "$(distdir)/node_modules" "$(distdir)/bower_components" "$(distdir)/package.json" "$(distdir)/bower.json" "$(distdir)/.bowerrc"

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

BOWER = $(srcdir)/bower_components

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
include src/ws/Makefile-ws.am
include src/reauthorize/Makefile-reauthorize.am
include src/retest/Makefile.am
include src/pam-ssh-add/Makefile.am
include containers/Makefile.am
