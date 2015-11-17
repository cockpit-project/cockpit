NULL =
man_MANS =
BUILT_SOURCES =
EXTRA_DIST = README.md branding
CLEANFILES = $(man_MANS)
DISTCLEANFILES =
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

SUFFIXES = .css .min.css .min.css.gz .js .js.gz .min.js .min.js.gz .html .min.html .min.html.gz .woff .woff.gz .1 .8 .5

V_CHECK = $(V_CHECK_$(V))
V_CHECK_ = $(V_CHECK_$(AM_DEFAULT_VERBOSITY))
V_CHECK_0 = @echo "  CHECK   " $@;

V_GZIP = $(V_GZIP_$(V))
V_GZIP_ = $(V_GZIP_$(AM_DEFAULT_VERBOSITY))
V_GZIP_0 = @echo "  GZIP    " $@;

GZIP = gzip -n

MV = mv -f

JSMODULE = $(srcdir)/tools/missing $(srcdir)/tools/jsmodule
CSSBUNDLE = $(srcdir)/tools/missing $(srcdir)/tools/cssbundle

.css.min.css:
	@$(MKDIR_P) $(dir $@)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/r.js -o cssIn=$< optimizeCss=standard logLevel=3 out=$@
.js.min.js:
	@$(MKDIR_P) $(dir $@)
	$(V_CHECK) $(srcdir)/tools/missing $(srcdir)/tools/jshint $<
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/uglifyjs $< --mangle > $@.tmp && $(MV) $@.tmp $@
.html.min.html:
	@$(MKDIR_P) $(dir $@)
	$(V_CHECK) $(srcdir)/tools/missing $(srcdir)/tools/jshint --extract=always $<
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/html-minifier --output $@ $<

.min.css.min.css.gz:
	@$(MKDIR_P) $(dir $@)
	$(V_GZIP) $(GZIP) -c $< > $@.tmp && $(MV) $@.tmp $@
.min.html.min.html.gz:
	@$(MKDIR_P) $(dir $@)
	$(V_GZIP) $(GZIP) -c $< > $@.tmp && $(MV) $@.tmp $@
.js.js.gz:
	@$(MKDIR_P) $(dir $@)
	$(V_GZIP) $(GZIP) -c $< > $@.tmp && $(MV) $@.tmp $@
.min.js.min.js.gz:
	@$(MKDIR_P) $(dir $@)
	$(V_GZIP) $(GZIP) -c $< > $@.tmp && $(MV) $@.tmp $@
.woff.woff.gz:
	@$(MKDIR_P) $(dir $@)
	$(V_GZIP) $(GZIP) -c $< > $@.tmp && $(MV) $@.tmp $@

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
	tools/pcp.supp \
	tools/unknown.supp \
	tools/zlib.supp \
	$(NULL)

valgrind-suppressions: $(VALGRIND_SUPPRESSIONS)
	$(AM_V_GEN) cat $^ > $@

check-memory: valgrind-suppressions
	$(MAKE) LOG_FLAGS="-- valgrind $(VALGRIND_ARGS)" \
	        HTML_LOG_FLAGS="valgrind $(VALGRIND_ARGS) cockpit-bridge" \
		$(AM_MAKEFLAGS) check
recheck-memory: valgrind-suppressions
	$(MAKE) LOG_FLAGS="-- valgrind $(VALGRIND_ARGS)" \
	        HTML_LOG_FLAGS="valgrind $(VALGRIND_ARGS) cockpit-bridge" \
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

GDBUS_CODEGEN = $(top_srcdir)/tools/gdbus-unbreak-codegen

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
	ln -sn $(libexecdir)/cockpit-bridge $(DESTDIR)$(testassetsdir)/cockpit-bridge

clean-local:
	find $(builddir) -name '*.gc??' -delete
	find $(srcdir) -name '*.pyc' -delete
	rm -rf mock-archives

uninstall-local:: uninstall-doc-local
	@true

install-data-hook::
	mkdir -p $(DESTDIR)$(localstatedir)/lib/cockpit
	-chgrp wheel $(DESTDIR)$(localstatedir)/lib/cockpit
	-chmod 775 $(DESTDIR)$(localstatedir)/lib/cockpit

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

dist-hook: dist-doc-hook
	echo $(VERSION) > $(distdir)/.tarball

distcheck-hook: dist-doc-hook
	$(srcdir)/tools/check-dist $(distdir)

upload-pot:
	zanata-cli push --project-config "$(srcdir)/tools/zanata.xml" -s "$(builddir)/po" -t "$(srcdir)/po"

download-po:
	zanata-cli -B pull --min-doc-percent 30 --project-config "$(srcdir)/tools/zanata.xml" -s "$(builddir)/po" -t "$(srcdir)/po"

BOWER = $(srcdir)/tools/bower_components

update-bower:
	( cd $(srcdir)/tools && ./bower update )

include pkg/base1/Makefile.am
include pkg/dashboard/Makefile.am
include pkg/docker/Makefile.am
include pkg/kubernetes/Makefile.am
include pkg/networkmanager/Makefile.am
include pkg/playground/Makefile.am
include pkg/realmd/Makefile.am
include pkg/shell/Makefile.am
include pkg/subscriptions/Makefile.am
include pkg/systemd/Makefile.am
include pkg/storaged/Makefile.am
include pkg/users/Makefile.am
include src/bridge/Makefile.am
include src/common/Makefile-common.am
include src/websocket/Makefile-websocket.am
include tools/Makefile-tools.am
include src/ws/Makefile-ws.am
include src/static/Makefile-static.am
include src/remotectl/Makefile-remotectl.am
include src/reauthorize/Makefile-reauthorize.am
include src/retest/Makefile.am
include src/pam-ssh-add/Makefile.am
include branding/default/Makefile.am
include branding/fedora/Makefile.am
include branding/centos/Makefile.am
include branding/rhel/Makefile.am
