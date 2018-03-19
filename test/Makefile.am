test_helpers = \
	libvirttest.py

test_programs = \
	test_connect.py \
	test_domain.py

TESTS = $(test_programs)

EXTRA_DIST = \
	$(test_helpers) \
	$(test_programs) \
	travis-run

TESTS_ENVIRONMENT = \
	abs_top_builddir=$(abs_top_builddir) \
	VIRT_DBUS_INTERFACES_DIR=$(abs_top_srcdir)/data
