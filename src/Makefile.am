AM_CPPFLAGS = \
	-I$(top_srcdir)/src

DAEMON_SOURCES = \
	main.c \
	manager.c manager.h \
	util.c util.h \
	domain.c domain.h

EXTRA_DIST = \
	$(DAEMON_SOURCES)
CLEANFILES =

bin_PROGRAMS = libvirt-dbus

libvirt_dbus_SOURCES = $(DAEMON_SOURCES)

libvirt_dbus_CFLAGS = \
	$(SYSTEMD_CFLAGS) \
	$(LIBVIRT_CFLAGS)

libvirt_dbus_LDFLAGS = \
	$(SYSTEMD_LDFLAGS) \
	$(LIBVIRT_LDFLAGS)

libvirt_dbus_LDADD = \
	$(SYSTEMD_LIBS) \
	$(LIBVIRT_LIBS)

service_in_files = \
	org.libvirt.service.in
servicedir = $(DBUS_SERVICES_DIR)
service_DATA = $(service_in_files:.service.in=.service)

EXTRA_DIST += \
	$(service_in_files)

CLEANFILES += \
	$(service_DATA)

org.libvirt.service: org.libvirt.service.in
	$(AM_V_GEN)sed \
		-e 's|[@]bindir[@]|$(bindir)|g' \
		< $< > $@-t && \
		mv $@-t $@
