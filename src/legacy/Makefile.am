libexec_PROGRAMS += cockpit-wrapper

dbus_built_sources = cockpit-generated.h cockpit-generated.c

cockpit-generated.h: cockpit-generated.c
cockpit-generated.c: Makefile.am $(top_srcdir)/src/legacy/com.redhat.Cockpit.xml
	$(AM_V_GEN) $(GDBUS_CODEGEN) \
		--interface-prefix com.redhat.Cockpit.				\
		--c-namespace Cockpit							\
		--c-generate-object-manager						\
		--generate-c-code cockpit-generated                             		\
		--generate-docbook cockpit-generated-doc					\
		$(top_srcdir)/src/legacy/com.redhat.Cockpit.xml	\
		$(NULL)

BUILT_SOURCES += $(dbus_built_sources)
CLEANFILES += cockpit-generated*

udisks_built_sources = org.freedesktop.UDisks2.h org.freedesktop.UDisks2.c

org.freedesktop.UDisks2.h: org.freedesktop.UDisks2.c
org.freedesktop.UDisks2.c: Makefile.am $(top_srcdir)/src/legacy/org.freedesktop.UDisks2.xml
	$(AM_V_GEN) $(GDBUS_CODEGEN) \
                --interface-prefix org.freedesktop.UDisks2. \
                --c-namespace UDisks \
                --c-generate-object-manager \
                --generate-c-code org.freedesktop.UDisks2 \
                $(top_srcdir)/src/legacy/org.freedesktop.UDisks2.xml \
                $(NULL)

BUILT_SOURCES += $(udisks_built_sources)
CLEANFILES += $(udisks_built_sources)

lvm_dbus_built_sources = com.redhat.lvm2.h com.redhat.lvm2.c

com.redhat.lvm2.h : com.redhat.lvm2.c
com.redhat.lvm2.c : Makefile.am src/legacy/com.redhat.lvm2.xml
	$(AM_V_GEN) $(GDBUS_CODEGEN)  \
		--interface-prefix com.redhat.lvm2 	\
		--c-namespace Lvm 			\
		--c-generate-object-manager 		\
		--generate-c-code com.redhat.lvm2 	\
		$(srcdir)/src/legacy/com.redhat.lvm2.xml \
		$(NULL)

BUILT_SOURCES += $(lvm_dbus_built_sources)
CLEANFILES += $(lvm_dbus_built_sources)

noinst_LIBRARIES += libcockpit-legacy.a

nodist_libcockpit_legacy_a_SOURCES = $(lvm_dbus_built_sources) $(udisks_built_sources)
libcockpit_legacy_a_SOURCES = \
	src/legacy/types.h \
	src/legacy/daemon.h \
	src/legacy/daemon.c \
	src/legacy/utils.h \
	src/legacy/utils.c \
	src/legacy/cpumonitor.h \
	src/legacy/cpumonitor.c \
	src/legacy/memorymonitor.h \
	src/legacy/memorymonitor.c \
	src/legacy/networkmonitor.h \
	src/legacy/networkmonitor.c \
	src/legacy/diskiomonitor.h \
	src/legacy/diskiomonitor.c \
	src/legacy/cgroupmonitor.h \
	src/legacy/cgroupmonitor.c \
	src/legacy/netdevmonitor.h \
	src/legacy/netdevmonitor.c \
	src/legacy/blockdevmonitor.h \
	src/legacy/blockdevmonitor.c \
	src/legacy/mountmonitor.h \
	src/legacy/mountmonitor.c \
	src/legacy/storagemanager.h \
	src/legacy/storagemanager.c \
	src/legacy/storageprovider.h \
	src/legacy/storageprovider.c \
	src/legacy/storageobject.h \
	src/legacy/storageobject.c \
	src/legacy/storageblock.h \
	src/legacy/storageblock.c \
	src/legacy/storagedrive.h \
	src/legacy/storagedrive.c \
	src/legacy/storagemdraid.h \
	src/legacy/storagemdraid.c \
	src/legacy/storagevolumegroup.h \
	src/legacy/storagevolumegroup.c \
	src/legacy/storagelogicalvolume.h \
	src/legacy/storagelogicalvolume.c \
	src/legacy/storagejob.h \
	src/legacy/storagejob.c \
	src/legacy/lvmutil.h \
	src/legacy/lvmutil.c \
	src/legacy/udisksclient.h \
	src/legacy/udisksclient.c \
	$(NULL)

libcockpit_legacy_a_CFLAGS = \
	-DG_LOG_DOMAIN=\"cockpit-wrapper\" \
	$(COCKPIT_WRAPPER_CFLAGS) \
	$(NULL)

cockpit_wrapper_SOURCES = \
	src/legacy/main.c \
	$(NULL)

cockpit_wrapper_CFLAGS = \
	-I$(top_srcdir)/src/legacy			\
	-DG_LOG_DOMAIN=\"cockpit-wrapper\" \
	$(COCKPIT_WRAPPER_CFLAGS) \
	$(NULL)

cockpit_wrapper_LDADD = \
	libcockpit-legacy.a \
	libcockpit-common.a \
	$(COCKPIT_WRAPPER_LIBS) \
	-lm 						\
	$(NULL)

dbusservice_DATA = com.redhat.Cockpit.service

com.redhat.Cockpit.service: src/legacy/com.redhat.Cockpit.service.in Makefile.am
	$(AM_V_GEN) $(SED_SUBST) $< > $@

EXTRA_DIST += \
	src/legacy/com.redhat.Cockpit.xml \
	src/legacy/com.redhat.Cockpit.service.in \
	src/legacy/com.redhat.lvm2.xml \
	src/legacy/org.freedesktop.UDisks2.xml \
	$(NULL)

CLEANFILES += \
	com.redhat.Cockpit.service \
	$(NULL)

# -----------------------------------------------------------------------------
# TESTS

DAEMON_CHECKS = \
	test-cgroupmonitor
test_cgroupmonitor_SOURCES = src/legacy/test-cgroupmonitor.c
test_cgroupmonitor_CFLAGS = $(libcockpit_legacy_a_CFLAGS)
test_cgroupmonitor_LDADD = $(cockpit_wrapper_LDADD)

noinst_PROGRAMS += $(DAEMON_CHECKS)
TESTS += $(DAEMON_CHECKS)
