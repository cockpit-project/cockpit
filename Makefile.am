NULL =
man_MANS =
BUILT_SOURCES =
EXTRA_DIST = README.md
CLEANFILES = *.js *.min.js *.html *.min.html *.css *.min.css
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

SUFFIXES = .js .min.js .css .min.css .html .min.html .1 .8 .5

.js.min.js:
	$(AM_V_GEN) $(RCOMPILE) -p -m -o $@ -- $^
.html.min.html:
	$(AM_V_GEN) $(RCOMPILE) -p -m -o $@ -- $^
.css.min.css:
	$(AM_V_GEN) $(RCOMPILE) -p -m -o $@ -- $^


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
	-I$(top_srcdir) \
	-I$(top_srcdir)/src \
	-DSRCDIR=\"$(abs_srcdir)\" \
	-DBUILDDIR=\"$(abs_builddir)\" \
	-DDATADIR=\"$(datadir)\" \
	-DPACKAGE_LIBEXEC_DIR=\""$(libexecdir)"\" \
	-DPACKAGE_SYSCONF_DIR=\""$(sysconfdir)"\" \
	-DPACKAGE_BIN_DIR=\""$(bindir)"\" \
	-DPACKAGE_LOCALSTATE_DIR=\""$(localstatedir)"\" \
	-DPACKAGE_LOCALE_DIR=\""$(localedir)"\" \
	-DPACKAGE_LIB_DIR=\""$(libdir)"\" \
	-D_POSIX_PTHREAD_SEMANTICS -D_REENTRANT \
	$(NULL)

LOG_DRIVER = $(top_srcdir)/tools/tap-driver
LOG_COMPILER = $(top_srcdir)/tools/tap-gtester

TEST_EXTENSIONS = .html
HTML_LOG_DRIVER = $(top_srcdir)/tools/tap-driver
if WITH_PHANTOMJS
HTML_LOG_COMPILER = $(top_srcdir)/tools/tap-phantom $(builddir)/test-server
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
	tools/unknown.supp \
	$(NULL)

valgrind-suppressions: $(VALGRIND_SUPPRESSIONS)
	$(AM_V_GEN) cat $^ > $@

check-memory: valgrind-suppressions
	$(MAKE) LOG_FLAGS="-- valgrind $(VALGRIND_ARGS)" \
		HTML_LOG_DRIVER_FLAGS="--missing=no-phantom-valgrind" \
		$(AM_MAKEFLAGS) check
recheck-memory: valgrind-suppressions
	$(MAKE) LOG_FLAGS="-- valgrind $(VALGRIND_ARGS)" \
		HTML_LOG_DRIVER_FLAGS="--missing=no-phantom-valgrind" \
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
        $(NULL)

RCOMPILE = JSL=$(JSL) $(top_srcdir)/tools/rcompile
PO2JSON = $(top_srcdir)/tools/po2json
GDBUS_CODEGEN = $(top_srcdir)/tools/gdbus-unbreak-codegen
VERIFY_CHECKSUMS = $(top_srcdir)/tools/verify-checksums

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

uninstall-local:: uninstall-doc-local
	@true

LATEST = latest/

if ENABLE_DOC

include doc/Makefile-doc.am
include doc/guide/Makefile-guide.am
include doc/man/Makefile-man.am

nodist_noinst_DATA += guide/index.html

install-data-local: guide/index.html
	$(MKDIR_P) $(DESTDIR)$(htmldir)
	$(INSTALL_DATA) `dirname $<`/* $(DESTDIR)$(htmldir)

uninstall-doc-local:
	rm -rf $(DESTDIR)$(htmldir)

upload-doc: guide/index.html
	rsync -Hvax guide/./ files.cockpit-project.org:/srv/guide/$(LATEST)./

dist-hook:
	@true

distcheck-hook:
	@true

else

uninstall-doc-local:
	@true
distcheck-hook:
	@echo "*** doc must be enabled (ie: --enable-doc) in order to make distcheck"
dist-hook:
	@echo "*** doc must be enabled (ie: --enable-doc) in order to make dist"
upload-doc:
	@echo "*** doc must be enabled (ie: --enable-doc) in order to make upload-doc"

endif

include pkg/base/Makefile.am
include pkg/playground/Makefile.am
include pkg/server-systemd/Makefile.am
include pkg/shell/Makefile.am
include src/bridge/Makefile.am
include src/common/Makefile-common.am
include src/websocket/Makefile-websocket.am
include tools/Makefile-tools.am
include src/ws/Makefile-ws.am
include src/daemon/Makefile-daemon.am
include src/static/Makefile-static.am
include src/remotectl/Makefile-remotectl.am
include src/reauthorize/Makefile-reauthorize.am
include src/selinux/Makefile-selinux.am
