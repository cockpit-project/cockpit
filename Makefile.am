NULL =
man_MANS =
BUILT_SOURCES =
EXTRA_DIST =
CLEANFILES =
check_SCRIPTS =
noinst_SCRIPTS =
libexec_PROGRAMS =
noinst_PROGRAMS =
noinst_LIBRARIES =
noinst_DATA =
TESTS =

ACLOCAL_AMFLAGS = -I tools ${ACLOCAL_FLAGS}

SUBDIRS = . po

DISTCHECK_CONFIGURE_FLAGS=						        \
	--with-systemdsystemunitdir=$$dc_install_base/$(systemdsystemunitdir)   \
	$(NULL)

AM_CPPFLAGS = \
	-I$(top_builddir) \
	-I$(top_srcdir) \
	-I$(top_srcdir)/src \
	-DSRCDIR=\"$(abs_srcdir)\" \
	-DBUILDDIR=\"$(abs_builddir)\" \
	-DPACKAGE_LIBEXEC_DIR=\""$(libexecdir)"\" \
	-DPACKAGE_SYSCONF_DIR=\""$(sysconfdir)"\" \
	-DPACKAGE_DATA_DIR=\""$(datadir)"\" \
	-DPACKAGE_BIN_DIR=\""$(bindir)"\" \
	-DPACKAGE_LOCALSTATE_DIR=\""$(localstatedir)"\" \
	-DPACKAGE_LOCALE_DIR=\""$(localedir)"\" \
	-DPACKAGE_LIB_DIR=\""$(libdir)"\" \
	-D_POSIX_PTHREAD_SEMANTICS -D_REENTRANT \
	-DCOCKPIT_COMPILATION \
	$(NULL)

LOG_DRIVER = $(top_srcdir)/tools/tap-driver
LOG_COMPILER = $(top_srcdir)/tools/tap-gtester

TEST_EXTENSIONS = .html
HTML_LOG_DRIVER = $(top_srcdir)/tools/tap-driver
if WITH_PHANTOMJS
HTML_LOG_COMPILER = $(top_srcdir)/tools/tap-phantom
else
HTML_LOG_DRIVER_FLAGS = --missing=phantomjs
endif

VALGRIND_ARGS = --trace-children=no --quiet --error-exitcode=33 \
	--suppressions=valgrind-suppressions --gen-suppressions=all \
	--num-callers=16
VALGRIND_SUPPRESSIONS = \
	tools/gcrypt.supp \
	tools/glib.supp \
	tools/pthread.supp \
	tools/unknown.supp \
	$(NULL)

valgrind-suppressions: $(VALGRIND_SUPPRESSIONS)
	$(AM_V_GEN) cat $^ > $@

check-memory: valgrind-suppressions
	$(MAKE) LOG_FLAGS="-- libtool --mode=execute valgrind $(VALGRIND_ARGS)" \
		HTML_LOG_DRIVER_FLAGS="--missing=no-phantom-valgrind" \
		$(AM_MAKEFLAGS) check
recheck-memory: valgrind-suppressions
	$(MAKE) LOG_FLAGS="-- libtool --mode=execute valgrind $(VALGRIND_ARGS)" \
		HTML_LOG_DRIVER_FLAGS="--missing=no-phantom-valgrind" \
		$(AM_MAKEFLAGS) recheck

if WITH_DEBUG
MINIFY = cat
else
MINIFY = $(top_srcdir)/tools/minify
endif

JSLINT = $(top_srcdir)/tools/js-lint
PO2JSON = $(top_srcdir)/tools/po2json
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
	for d in $(testassets_data); do $(INSTALL_DATA) $$d $(DESTDIR)$(testassetsdir); done
	for d in $(testassets_systemdunit_data); do $(INSTALL_DATA) $$d $(DESTDIR)$(systemdunitdir); done

include doc/Makefile-doc.am
include doc/man/Makefile-man.am
include data/Makefile-data.am
include src/cockpit/Makefile-libcockpit.am
include src/websocket/Makefile-websocket.am
include tools/Makefile-tools.am

include src/agent/Makefile-agent.am
include src/ws/Makefile-ws.am
include src/daemon/Makefile-daemon.am
include src/web/Makefile-web.am
