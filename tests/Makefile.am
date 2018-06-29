AM_CPPFLAGS = \
	-I$(top_srcdir)/src \
	$(NULL)

test_helpers = \
	xmldata.py \
	libvirttest.py \
	conftest.py \
	$(NULL)

test_programs = \
	test_connect.py \
	test_domain.py \
	test_network.py \
	test_nodedev.py \
	test_storage.py \
	$(NULL)

check_PROGRAMS = \
	test_util \
	$(NULL)

test_util_SOURCES = \
	test_util.c \
	$(NULL)
test_util_CFLAGS = \
	$(GIO2_CFLAGS) \
	$(GLIB2_CFLAGS) \
	$(LIBVIRT_CFLAGS) \
	$(NULL)
test_util_LDFLAGS = \
	$(GIO2_LDFLAGS) \
	$(GLIB2_LDFLAGS) \
	$(LIBVIRT_LDFLAGS) \
	$(NULL)
test_util_LDADD = \
	$(top_builddir)/src/libutil.la \
	$(GIO2_LIBS) \
	$(GLIB2_LIBS) \
	$(LIBVIRT_LIBS) \
	$(NULL)

EXTRA_DIST = \
	$(test_helpers) \
	$(test_programs) \
	travis-run \
	$(NULL)

TESTS = \
	$(check_PROGRAMS) \
	$(test_programs) \
	$(NULL)

AM_TESTS_ENVIRONMENT = \
	export abs_top_builddir="$(abs_top_builddir)"; \
	export VIRT_DBUS_INTERFACES_DIR="$(abs_top_srcdir)/data";
