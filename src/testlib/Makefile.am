# -----------------------------------------------------------------------------
# Common cpp and ld flags for tests: these will be used an awful lot

TEST_CPP = \
	-DSRCDIR=\"$(abs_srcdir)\" \
	-DBUILDDIR=\"$(abs_builddir)\" \
	$(glib_CFLAGS) \
	$(json_glib_CFLAGS) \
	$(AM_CPPFLAGS)

TEST_LIBS = \
	libcockpit-test.a \
	$(libcockpit_common_a_LIBS) \
	$(NULL)

# -----------------------------------------------------------------------------
# Some helpful variables to get tests into TESTS and check_* in one go

# Unfortunately, we can't call these _PROGRAMS or _SCRIPTS because otherwise
# automake will treat them differently, which we don't want.

TEST_PROGRAM =
TESTS += $(TEST_PROGRAM)
check_PROGRAMS = $(TEST_PROGRAM)

TEST_SCRIPT =
TESTS += $(TEST_SCRIPT)
check_SCRIPTS = $(TEST_SCRIPT)

dist_TEST_SCRIPT =
TESTS += $(dist_TEST_SCRIPT)
dist_check_SCRIPTS = $(dist_TEST_SCRIPT)

# Testing assets should add themselves here (not EXTRA_DIST)
check_DATA =
dist_check_DATA =

# -----------------------------------------------------------------------------
# libcockpit-test.a: code used only for unit tests

check_LIBRARIES = libcockpit-test.a

libcockpit_test_a_CPPFLAGS = \
	-DG_LOG_DOMAIN=\"cockpit-test\" \
	$(TEST_CPP)

libcockpit_test_a_SOURCES = \
	src/testlib/cockpittest.c \
	src/testlib/cockpittest.h \
	src/testlib/mock-auth.c \
	src/testlib/mock-auth.h \
	src/testlib/mock-channel.c \
	src/testlib/mock-channel.h \
	src/testlib/mock-pressure.c \
	src/testlib/mock-pressure.h \
	src/testlib/mock-transport.c \
	src/testlib/mock-transport.h \
	src/testlib/retest.c \
	src/testlib/retest.h \
	$(NULL)
