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

dist_systemdunit_DATA   =
nodist_systemdunit_DATA =

TESTS = \
	pkg/users/test-list-public-keys.sh \
	$(NULL)

CLEANFILES = \
	$(man_MANS) \
	valgrind-suppressions \
	$(NULL)

DISTCLEANFILES = \
	$(srcdir)/Makefile \
	node_modules \
	$(NULL)

EXTRA_DIST = \
	bower.json \
	src/branding \
	README.md \
	$(NULL)

clean-local:
	find $(builddir) -name '*.gc??' -delete
	find $(srcdir) -name '*.pyc' -delete

SUFFIXES = .css .css.gz .min.css .min.css.gz .js .js.gz .min.js .min.js.gz .map .map.gz .jsx .html .html.gz .min.html .min.html.gz .svg .svg.gz .woff .woff.gz .1 .8 .5

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

JSMODULE = $(srcdir)/tools/missing $(srcdir)/tools/jsmodule

COPY_RULE = \
        $(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp -L $< $@.tmp && $(MV) $@.tmp $@

MIN_JS_RULE = \
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/tools/missing $(srcdir)/tools/uglifyjs $^ --mangle > $@.tmp && $(MV) $@.tmp $@

MIN_CSS_RULE = \
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/tools/missing $(srcdir)/tools/r.js -o cssIn=$< optimizeCss=standard logLevel=3 out=$@

MIN_HTML_RULE = \
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/tools/missing $(srcdir)/tools/htmlmin $@ $<

GZ_RULE = \
	$(V_GZIP) $(MKDIR_P) $(dir $@) && \
	gzip -n -c $< > $@.tmp && $(MV) $@.tmp $@

.css.min.css:
	$(MIN_CSS_RULE)
.js.min.js:
	$(V_CHECK) $(srcdir)/tools/missing $(srcdir)/tools/jshint $<
	$(MIN_JS_RULE)
.jsx.js:
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
		$(srcdir)/tools/missing $(srcdir)/tools/jsx < $< > $@.tmp && $(MV) $@.tmp $@
.jsx.min.js:
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
		$(srcdir)/tools/missing $(srcdir)/tools/jsx < $< | \
		$(srcdir)/tools/missing $(srcdir)/tools/uglifyjs --mangle > $@.tmp && $(MV) $@.tmp $@
.html.min.html:
	$(V_CHECK) $(srcdir)/tools/missing $(srcdir)/tools/jshint --extract=always $<
	$(MIN_HTML_RULE)

.css.css.gz:
	$(GZ_RULE)
.min.css.min.css.gz:
	$(GZ_RULE)
.html.html.gz:
	$(GZ_RULE)
.min.html.min.html.gz:
	$(GZ_RULE)
.js.js.gz:
	$(GZ_RULE)
.min.js.min.js.gz:
	$(GZ_RULE)
.map.map.gz:
	$(GZ_RULE)
.svg.svg.gz:
	$(GZ_RULE)
.woff.woff.gz:
	$(GZ_RULE)

po/po.%.js: po/%.po
	@$(MKDIR_P) $(dir $@)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/po2json --module $^ $@

# Webpack related

V_WEBPACK = $(V_WEBPACK_$(V))
V_WEBPACK_ = $(V_WEBPACK_$(AM_DEFAULT_VERBOSITY))
V_WEBPACK_0 = @echo "  WEBPACK  dist/";

WEBPACK_INPUTS =
WEBPACK_OUTPUTS =
WEBPACK_CONFIG = webpack.config.js

noinst_SCRIPTS += Makefile-webpack.deps $(WEBPACK_INSTALL)
CLEANFILES += Makefile-webpack.deps $(WEBPACK_OUTPUTS)
EXTRA_DIST += Makefile-webpack.deps $(WEBPACK_CONFIG)

@INCLUDE_WEBPACK_DEPS@

WEBPACK_RULE = $(V_WEBPACK) NODE_ENV=$(NODE_ENV) SRCDIR=$(srcdir) BUILDDIR=$(builddir) \
	       $(srcdir)/tools/missing $(srcdir)/tools/webpack-make -d $@ $<

Makefile-webpack.deps: $(WEBPACK_CONFIG) tools/webpack-make $(WEBPACK_INPUTS)
	$(WEBPACK_RULE)

all-local:: Makefile-webpack.deps $(WEBPACK_OUTPUTS) $(WEBPACK_INSTALL)
	@true
distclean-local::
	rm -rf dist/
install-data-local:: $(WEBPACK_INSTALL)
	tar -cf - $^ | tar -C $(DESTDIR)$(pkgdatadir) --strip-components=1 -xvf -
	$(SED_SUBST) -i $(DESTDIR)$(pkgdatadir)/*/manifest.json
uninstall-local::
	rm -rf $(DESTDIR)$(pkgdatadir)
dist-hook:: $(WEBPACK_INPUTS) $(WEBPACK_OUTPUTS)
	tar -cf - $^ | tar -C $(distdir) -xvf -

#

ACLOCAL_AMFLAGS = -I tools ${ACLOCAL_FLAGS}

SUBDIRS = . po

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

VALGRIND_ARGS = --trace-children=no --quiet --error-exitcode=33 \
	--suppressions=valgrind-suppressions --gen-suppressions=all \
	--num-callers=16 --leak-check=yes --show-leak-kinds=definite \
	--errors-for-leak-kinds=definite
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

LATEST = latest/

if ENABLE_DOC

include doc/Makefile-doc.am
include doc/guide/Makefile-guide.am
include doc/man/Makefile-man.am

noinst_DATA += doc/guide/html

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
install-data-local:: doc/guide/html/index.html
	$(MKDIR_P) $(DESTDIR)$(htmldir)
	$(INSTALL_DATA) `dirname $<`/* $(DESTDIR)$(htmldir)
uninstall-local::
	rm -rf $(DESTDIR)$(htmldir)

print-%:
	@echo $($*)

# Subdirectories to distribute everything that's committed to git
COMMITTED_DIST = \
	lib/ \
	pkg/ \
	lib/ \
	tools/ \
	test/ \
	$(NULL)

# Build up the distribution using $COMMITTED_DIST and include node_modules and bower licenses
dist-hook::
	( cd $(srcdir); git ls-tree HEAD --name-only -r $(COMMITTED_DIST) || (echo $(COMMITTED_DIST) | tr ' ' '\n' ) ) | \
		tar -C $(srcdir) -cf - -T - | tar -C $(distdir) -xf -
	tar -C $(srcdir) -cf - --exclude='phantomjs*' --exclude='jshint*' node_modules/ | tar -C $(distdir) -xf -
	echo $(VERSION) > $(distdir)/.tarball
	$(srcdir)/tools/build-copying $(distdir)/node_modules > $(distdir)/COPYING.node
	$(srcdir)/tools/build-copying $(BOWER) > $(distdir)/COPYING.bower

dist-xz: distdir
	tar --format=posix -cf - "$(distdir)" | xz -ec > $(distdir).tar.xz
	find "$(distdir)" -type d ! -perm -200 -exec chmod u+w {} ';' && rm -rf "$(distdir)"

distcheck-hook::
	$(srcdir)/tools/check-dist $(distdir)

update-pofiles:
	cd $(srcdir) && \
	echo "# Generated by make update-potfiles" > po/POTFILES.in && \
	cat po/POTFILES.in.in >> po/POTFILES.in && \
	find pkg/ -name "*.js" | xargs grep -l "gettext" >> po/POTFILES.in && \
	find lib/ -name "*.js" | xargs grep -l "gettext" >> po/POTFILES.in && \
	find src/base1/ -name "*.js" | xargs grep -l "gettext" >> po/POTFILES.in && \
	find pkg/ -name "*.html" | xargs grep -l "translatable" | sed -e "s#\(.*\)#[type: gettext/glade] \1#g" >> po/POTFILES.in && \
	find lib/ -name "*.html" | xargs grep -l "translatable" | sed -e "s#\(.*\)#[type: gettext/glade] \1#g" >> po/POTFILES.in


upload-pot:
	zanata-cli push --project-config "$(srcdir)/tools/zanata.xml" -s "$(builddir)/po" -t "$(srcdir)/po"

download-po:
	zanata-cli -B pull --min-doc-percent 30 --project-config "$(srcdir)/tools/zanata.xml" -s "$(builddir)/po" -t "$(srcdir)/po"

# Build and install po.xx.js files
podir = $(pkgdatadir)/shell
po_FILES = $(addprefix po/po.,$(addsuffix .js,$(shell cat $(srcdir)/po/LINGUAS)))
nodist_po_DATA = $(po_FILES:.js=.js.gz) po/po.js.gz
EXTRA_DIST += po/po.js $(po_FILES)
CLEANFILES += $(nodist_po_DATA) po/po.js.gz $(po_FILES)

BOWER = $(srcdir)/lib

BOWER_CLEAN = \
	$(BOWER)/bootstrap-switch/ \
	$(BOWER)/bootstrap-touchspin/ \
	$(BOWER)/bootstrap-treeview \
	$(BOWER)/c3 \
	$(BOWER)/datatables* \
	$(BOWER)/google-code-prettify \
	$(BOWER)/matchHeight \
	$(BOWER)/patternfly/less/lib \
	$(BOWER)/term.js \
	$(NULL)

update-bower:
	cd $(srcdir) && bower update
	rm -rf $(BOWER_CLEAN)

include lib/Makefile.am
include pkg/docker/Makefile.am
include pkg/kubernetes/Makefile.am
include pkg/systemd/Makefile.am
include pkg/storaged/Makefile.am
include src/base1/Makefile.am
include src/branding/centos/Makefile.am
include src/branding/default/Makefile.am
include src/branding/fedora/Makefile.am
include src/branding/kubernetes/Makefile.am
include src/branding/registry/Makefile.am
include src/branding/rhel/Makefile.am
include src/bridge/Makefile.am
include src/common/Makefile-common.am
include src/websocket/Makefile-websocket.am
include tools/Makefile-tools.am
include src/ws/Makefile-ws.am
include src/remotectl/Makefile-remotectl.am
include src/reauthorize/Makefile-reauthorize.am
include src/retest/Makefile.am
include src/pam-ssh-add/Makefile.am
include src/static/Makefile-static.am
include containers/Makefile.am
