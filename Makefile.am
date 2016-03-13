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
TESTS =

dist_systemdunit_DATA   =
nodist_systemdunit_DATA =

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
	branding \
	node_modules \
	README.md \
	$(NULL)

SUFFIXES = .css .min.css .min.css.gz .js .js.gz .min.js .min.js.gz .html .min.html .min.html.gz .woff .woff.gz .1 .8 .5

V_CHECK = $(V_CHECK_$(V))
V_CHECK_ = $(V_CHECK_$(AM_DEFAULT_VERBOSITY))
V_CHECK_0 = @echo "  CHECK   " $@;

V_GZIP = $(V_GZIP_$(V))
V_GZIP_ = $(V_GZIP_$(AM_DEFAULT_VERBOSITY))
V_GZIP_0 = @echo "  GZIP    " $@;

MV = mv -f

JSMODULE = $(srcdir)/tools/missing $(srcdir)/tools/jsmodule
CSSBUNDLE = $(srcdir)/tools/missing $(srcdir)/tools/cssbundle

MIN_JS_RULE = \
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/tools/missing $(srcdir)/tools/uglifyjs $< --mangle > $@.tmp && $(MV) $@.tmp $@

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
.html.min.html:
	$(V_CHECK) $(srcdir)/tools/missing $(srcdir)/tools/jshint --extract=always $<
	$(MIN_HTML_RULE)

.min.css.min.css.gz:
	$(GZ_RULE)
.min.html.min.html.gz:
	$(GZ_RULE)
.js.js.gz:
	$(GZ_RULE)
.min.js.min.js.gz:
	$(GZ_RULE)
.woff.woff.gz:
	$(GZ_RULE)

po/po.%.js: po/%.po
	@$(MKDIR_P) $(dir $@)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/po2json --module $^ $@

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

clean-local:
	find $(builddir) -name '*.gc??' -delete
	find $(srcdir) -name '*.pyc' -delete
	rm -rf mock-archives

uninstall-local:: uninstall-doc-local
	@true

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

install-doc-local: doc/guide/html/index.html
	$(MKDIR_P) $(DESTDIR)$(htmldir)
	$(INSTALL_DATA) `dirname $<`/* $(DESTDIR)$(htmldir)

uninstall-doc-local:
	rm -rf $(DESTDIR)$(htmldir)

dist-doc-hook:
	@true

else

install-doc-local:
	@true
uninstall-doc-local:
	@true
dist-doc-hook:
	@echo "*** doc must be enabled (ie: --enable-doc) in order to make dist or distcheck"

endif

install-data-local:: install-doc-local
	@true

# Subdirectories to distribute everything that's committed to git
COMMITTED_DIST = \
	bower_components/ \
	pkg/ \
	po/ \
	tools/ \
	test/ \
	$(NULL)

dist-hook: dist-doc-hook
	( git -C $(srcdir) ls-tree HEAD --name-only -r $(COMMITTED_DIST) || echo $(COMMITTED_DIST) ) | \
		tar -C $(srcdir) -cf - -T - | tar -C $(distdir) -xvf -
	echo $(VERSION) > $(distdir)/.tarball
	$(srcdir)/tools/build-copying $(srcdir)/node_modules > $(distdir)/COPYING.node
	$(srcdir)/tools/build-copying $(BOWER) > $(distdir)/COPYING.bower

dist-xz: distdir
	tar --format=posix -cf - "$(distdir)" | xz -ec > $(distdir).tar.xz
	find "$(distdir)" -type d ! -perm -200 -exec chmod u+w {} ';' && rm -rf "$(distdir)"

distcheck-hook: dist-doc-hook
	$(srcdir)/tools/check-dist $(distdir)

update-pofiles:
	cd $(srcdir) && \
	echo "# Generated by make update-potfiles" > po/POTFILES.in && \
	cat po/POTFILES.in.in >> po/POTFILES.in && \
	find pkg/ -name "*.js" | xargs grep -l "gettext" >> po/POTFILES.in && \
	find pkg/ -name "*.html" | xargs grep -l "translatable" | sed -e "s#\(.*\)#[type: gettext/glade] \1#g" >> po/POTFILES.in

upload-pot:
	zanata-cli push --project-config "$(srcdir)/tools/zanata.xml" -s "$(builddir)/po" -t "$(srcdir)/po"

download-po:
	zanata-cli -B pull --min-doc-percent 30 --project-config "$(srcdir)/tools/zanata.xml" -s "$(builddir)/po" -t "$(srcdir)/po"

BOWER = $(srcdir)/bower_components

BOWER_CLEAN = \
	$(BOWER)/patternfly/components/bootstrap-treeview \
	$(BOWER)/patternfly/components/google-code-prettify \
	$(BOWER)/patternfly/components/datatables* \
	$(BOWER)/patternfly/components/?3 \
	$(BOWER)/patternfly/components/jquery \
	$(BOWER)/patternfly/components/matchHeight \
	$(NULL)

update-bower:
	cd $(srcdir) && bower update
	rm -rf $(BOWER_CLEAN)

include pkg/base1/Makefile.am
include pkg/dashboard/Makefile.am
include pkg/docker/Makefile.am
include pkg/kubernetes/Makefile.am
include pkg/networkmanager/Makefile.am
include pkg/ostree/Makefile.am
include pkg/playground/Makefile.am
include pkg/realmd/Makefile.am
include pkg/shell/Makefile.am
include pkg/sosreport/Makefile.am
include pkg/subscriptions/Makefile.am
include pkg/systemd/Makefile.am
include pkg/storaged/Makefile.am
include pkg/tuned/Makefile.am
include pkg/users/Makefile.am
include src/bridge/Makefile.am
include src/common/Makefile-common.am
include src/websocket/Makefile-websocket.am
include tools/Makefile-tools.am
include src/ws/Makefile-ws.am
include src/remotectl/Makefile-remotectl.am
include src/reauthorize/Makefile-reauthorize.am
include src/retest/Makefile.am
include src/pam-ssh-add/Makefile.am
include static/Makefile-static.am
include branding/centos/Makefile.am
include branding/default/Makefile.am
include branding/fedora/Makefile.am
include branding/kubernetes/Makefile.am
include branding/registry/Makefile.am
include branding/rhel/Makefile.am
include containers/Makefile.am
