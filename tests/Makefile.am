test_helpers = \
	xmldata.py \
	libvirttest.py \
	conftest.py

test_programs = \
	$(check_PROGRAMS) \
	test_connect.py \
	test_domain.py \
	test_network.py \
	test_nodedev.py \
	test_storage.py

check_PROGRAMS = \
	test_util

test_util_SOURCES = \
	test_util.c $(top_srcdir)/src/util.c
test_util_CFLAGS = \
	-I$(top_srcdir)/src \
	$(GIO2_CFLAGS) \
	$(GLIB2_CFLAGS) \
	$(LIBVIRT_CFLAGS)
test_util_LDFLAGS = \
	$(GIO2_LDFLAGS) \
	$(GLIB2_LDFLAGS) \
	$(LIBVIRT_LDFLAGS)
test_util_LDADD = \
	$(GIO2_LIBS) \
	$(GLIB2_LIBS) \
	$(LIBVIRT_LIBS)

EXTRA_DIST = \
	$(test_helpers) \
	$(test_programs) \
	travis-run

TESTS = $(test_programs)

AM_TESTS_ENVIRONMENT = \
	export abs_top_builddir="$(abs_top_builddir)"; \
	export VIRT_DBUS_INTERFACES_DIR="$(abs_top_srcdir)/data";
