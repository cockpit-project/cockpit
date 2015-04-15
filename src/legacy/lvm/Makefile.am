
noinst_LIBRARIES += libstoraged.a

nodist_libstoraged_a_SOURCES = $(lvm_dbus_built_sources) $(udisks_built_sources)
libstoraged_a_SOURCES = \
	src/legacy/lvm/types.h \
	src/legacy/lvm/block.h src/legacy/lvm/block.c \
	src/legacy/lvm/daemon.h src/legacy/lvm/daemon.c \
	src/legacy/lvm/invocation.h src/legacy/lvm/invocation.c \
	src/legacy/lvm/job.h src/legacy/lvm/job.c \
	src/legacy/lvm/logicalvolume.h src/legacy/lvm/logicalvolume.c \
	src/legacy/lvm/manager.h src/legacy/lvm/manager.c \
	src/legacy/lvm/physicalvolume.h src/legacy/lvm/physicalvolume.c \
	src/legacy/lvm/spawnedjob.h src/legacy/lvm/spawnedjob.c \
	src/legacy/lvm/threadedjob.h src/legacy/lvm/threadedjob.c \
	src/legacy/udisksclient.h src/legacy/udisksclient.c \
	src/legacy/lvm/util.h src/legacy/lvm/util.c \
	src/legacy/lvm/volumegroup.h src/legacy/lvm/volumegroup.c \
	$(NULL)

libstoraged_a_CFLAGS = \
	-I$(top_srcdir) \
	-I$(top_srcdir)/src/legacy \
	-DG_LOG_DOMAIN=\"cockpit-lvm\" \
	$(COCKPIT_LVM_CFLAGS) \
	$(NULL)

libstoraged_a_LIBS = $(COCKPIT_LVM_LIBS)

# ----------------------------------------------------------------------------------------------------

libexec_PROGRAMS += cockpit-lvm cockpit-lvm-helper

cockpit_lvm_SOURCES = \
	src/legacy/lvm/main.c \
	$(NULL)

cockpit_lvm_CFLAGS = \
	$(libstoraged_a_CFLAGS)
	$(NULL)

cockpit_lvm_LDADD = \
	libstoraged.a \
	$(COCKPIT_LVM_LIBS)
	$(NULL)

cockpit_lvm_helper_SOURCES = \
	src/legacy/lvm/helper.c \
	$(NULL)

cockpit_lvm_helper_CFLAGS = \
	-DPACKAGE_DATA_DIR="\"$(datadir)/cockpit\"" \
	$(libstoraged_a_CFLAGS) \
	$(LVM2_CFLAGS) \
	$(NULL)

cockpit_lvm_helper_LDADD = \
	$(COCKPIT_LIBS) \
	$(LVM2_LIBS) \
	-llvm2app \
	$(NULL)

# ----------------------------------------------------------------------------------------------------

noinst_LIBRARIES += libstoragetesting.a

libstoragetesting_a_SOURCES = \
	src/legacy/lvm/testing.h src/legacy/lvm/testing.c \
	src/legacy/lvm/util.h src/legacy/lvm/util.c \
	$(NULL)
libstoragetesting_a_CFLAGS = $(libstoraged_a_CFLAGS)

LVM_CHECKS = \
	test-storage-jobs \
	test-storage-block \
	test-storage-dynamic \
	test-storage-methods \
	$(NULL)

noinst_PROGRAMS += $(LVM_CHECKS) frob-helper

TESTS += $(LVM_CHECKS)

frob_helper_SOURCES = src/legacy/lvm/frob-helper.c
frob_helper_CFLAGS = $(libstoragetesting_a_CFLAGS)
frob_helper_LDADD = $(COCKPIT_LVM_LIBS)

test_storage_jobs_SOURCES = src/legacy/lvm/test-jobs.c
test_storage_jobs_CFLAGS = $(libstoragetesting_a_CFLAGS)
test_storage_jobs_LDADD = libstoraged.a libstoragetesting.a $(COCKPIT_LVM_LIBS)

test_storage_block_SOURCES = src/legacy/lvm/test-block.c
test_storage_block_CFLAGS = $(libstoragetesting_a_CFLAGS)
test_storage_block_LDADD = libstoraged.a libstoragetesting.a $(COCKPIT_LVM_LIBS)

test_storage_dynamic_SOURCES = src/legacy/lvm/test-dynamic.c
test_storage_dynamic_CFLAGS = $(libstoragetesting_a_CFLAGS)
test_storage_dynamic_LDADD = libstoraged.a libstoragetesting.a $(COCKPIT_LVM_LIBS)

test_storage_methods_SOURCES = src/legacy/lvm/test-methods.c
test_storage_methods_CFLAGS = $(libstoragetesting_a_CFLAGS)
test_storage_methods_LDADD = libstoraged.a libstoragetesting.a $(COCKPIT_LVM_LIBS)

# ----------------------------------------------------------------------------------------------------

dbussystemdir       = $(datadir)/dbus-1/system-services
dbussystem_in_files = src/legacy/lvm/com.redhat.Cockpit.LVM.service.in
dbussystem_DATA     = $(dbussystem_in_files:.service.in=.service)

$(dbussystem_DATA): $(dbussystem_in_files) Makefile
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && sed -e "s|\@libexecdir\@|$(libexecdir)|" $< > $@

dbusconfdir = $(sysconfdir)/dbus-1/system.d
dbusconf_in_files = src/legacy/lvm/com.redhat.Cockpit.LVM.conf.in
dbusconf_DATA = $(dbusconf_in_files:.conf.in=.conf)

$(dbusconf_DATA): $(dbusconf_in_files) Makefile
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && cp $< $@

polkitdir        = $(datadir)/polkit-1/actions
polkit_in_files  = src/legacy/lvm/com.redhat.Cockpit.LVM.policy.in
polkit_DATA      = $(polkit_in_files:.policy.in=.policy)

@INTLTOOL_POLICY_RULE@

install-data-local::
	$(MKDIR_P) $(DESTDIR)$(datadir)/cockpit/lvm-nolocking
	$(INSTALL_DATA) $(srcdir)/src/legacy/lvm/lvm-nolocking.conf $(DESTDIR)$(datadir)/cockpit/lvm-nolocking/lvm.conf
uninstall-local::
	rm -f $(DESTDIR)$(datadir)/cockpit/lvm-nolocking/lvm.conf

EXTRA_DIST += \
	$(dbussystem_in_files)	\
	$(dbusconf_in_files) \
	$(polkit_in_files) \
	src/legacy/lvm/lvm-nolocking.conf \
	$(NULL)

CLEANFILES += \
	$(dbussystem_DATA) \
	$(dbusconf_DATA) \
	$(polkit_DATA) \
	$(NULL)

