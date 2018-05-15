test_helpers = \
	libvirttest.py \
	conftest.py

test_programs = \
	test_connect.py \
	test_domain.py \
	test_network.py \
	test_storage.py

EXTRA_DIST = \
	$(test_helpers) \
	$(test_programs) \
	travis-run

TESTS = $(test_programs)

TESTS_ENVIRONMENT = \
	abs_top_builddir=$(abs_top_builddir) \
	VIRT_DBUS_INTERFACES_DIR=$(abs_top_srcdir)/data
