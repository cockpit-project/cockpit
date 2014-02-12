NULL =
man_MANS =
BUILT_SOURCES =
EXTRA_DIST =
CLEANFILES =
noinst_SCRIPTS =
libexec_PROGRAMS =
noinst_PROGRAMS =
noinst_LTLIBRARIES =
privlibdir = $(pkglibdir)
privlib_LTLIBRARIES =
noinst_LIBRARIES=
TESTS =

ACLOCAL_AMFLAGS = -I tools ${ACLOCAL_FLAGS}

SUBDIRS = doc po

DISTCHECK_CONFIGURE_FLAGS=						        \
	--disable-introspection						        \
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

include doc/man/Makefile-man.am
include data/Makefile-data.am
include src/cockpit/Makefile-libcockpit.am
include src/websocket/Makefile-websocket.am
include tools/Makefile-tools.am

libgsystem_srcpath := src/libgsystem
libgsystem_cflags := -Isrc/libgsystem $(GIO_CFLAGS)

include src/ws/Makefile-ws.am
include src/daemon/Makefile-daemon.am
include src/web/Makefile-web.am
