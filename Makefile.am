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

SUBDIRS = . doc po

DISTCHECK_CONFIGURE_FLAGS=						        \
	--with-systemdsystemunitdir=$$dc_install_base/$(systemdsystemunitdir)   \
	$(NULL)

AM_CPPFLAGS = \
	-DSRCDIR=\"$(abs_srcdir)\" \
	-DBUILDDIR=\"$(abs_builddir)\" \
	$(NULL)

cockpit_cppflags_common = \
	-I$(top_builddir) \
	-I$(top_srcdir) \
	-I$(top_srcdir)/src \
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

cockpit_cppflags_glib_version = \
	-DGLIB_VERSION_MIN_REQUIRED=GLIB_VERSION_2_34 \
	-DGLIB_VERSION_MAX_ALLOWED=GLIB_VERSION_2_34 \
	$(NULL)

LOG_DRIVER = $(top_srcdir)/tools/tap-driver
LOG_COMPILER = $(top_srcdir)/tools/tap-compiler
TEST_EXTENSIONS = .html
HTML_LOG_DRIVER = $(top_srcdir)/tools/tap-driver
if WITH_PHANTOMJS
HTML_LOG_COMPILER = $(top_srcdir)/tools/tap-phantom
else
HTML_LOG_COMPILER = $(top_srcdir)/tools/tap-missing --missing=phantomjs
endif


MINIFY = $(top_srcdir)/tools/minify
JSLINT = $(top_srcdir)/tools/js-lint
PO2JSON = $(top_srcdir)/tools/po2json

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

include doc/man/Makefile-man.am
include data/Makefile-data.am
include src/cockpit/Makefile-libcockpit.am
include src/websocket/Makefile-websocket.am
include tools/Makefile-tools.am

# We only use the memory allocation code from libgsystem
libgsystem_srcpath := $(top_srcdir)/src/libgsystem
libgsystem_cflags := -I$(top_srcdir)/src/libgsystem $(GIO_CFLAGS)
EXTRA_DIST += src/libgsystem/gsystem-local-alloc.h

include src/ws/Makefile-ws.am
include src/daemon/Makefile-daemon.am
include src/web/Makefile-web.am
