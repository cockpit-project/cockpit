AM_CPPFLAGS = \
	-I$(top_srcdir)/src \
	-DVIRT_DBUS_INTERFACES_DIR=\"$(DBUS_INTERFACES_DIR)\" \
	$(NULL)
AM_CFLAGS = \
	$(GIO2_CFLAGS) \
	$(GLIB2_CFLAGS) \
	$(LIBVIRT_CFLAGS) \
	$(LIBVIRT_GLIB_CFLAGS) \
	$(WARN_CFLAGS) \
	$(PIE_CFLAGS) \
	$(NULL)
AM_LDFLAGS = \
	$(GIO2_LDFLAGS) \
	$(GLIB2_LDFLAGS) \
	$(LIBVIRT_LDFLAGS) \
	$(LIBVIRT_GLIB_LDFLAGS) \
	$(RELRO_LDFLAGS) \
	$(PIE_LDFLAGS) \
	$(NULL)

noinst_LTLIBRARIES = \
	libutil.la \
	$(NULL)

libutil_la_SOURCES = \
	util.c \
	util.h \
	$(NULL)

bin_PROGRAMS = \
	libvirt-dbus \
	$(NULL)

libvirt_dbus_SOURCES = \
	connect.c \
	connect.h \
	domain.c \
	domain.h \
	events.c \
	events.h \
	gdbus.c \
	gdbus.h \
	main.c \
	network.c \
	network.h \
	nodedev.c \
	nodedev.h \
	nwfilter.c \
	nwfilter.h \
	secret.c \
	secret.h \
	storagepool.c \
	storagepool.h \
	storagevol.c \
	storagevol.h \
	$(NULL)
libvirt_dbus_LDADD = \
	libutil.la \
	$(GIO2_LIBS) \
	$(GLIB2_LIBS) \
	$(LIBVIRT_LIBS) \
	$(LIBVIRT_GLIB_LIBS) \
	$(NULL)
