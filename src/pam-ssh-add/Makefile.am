# -----------------------------------------------------------------------------
# libpam_ssh_add.a: code used in pam_ssh_add.so and its tests

noinst_LIBRARIES += libpam_ssh_add.a

libpam_ssh_add_a_CFLAGS = -fPIC $(AM_CFLAGS)

libpam_ssh_add_a_LIBS = \
	libpam_ssh_add.a \
	-lpam \
	$(NULL)

libpam_ssh_add_a_SOURCES = \
	src/pam-ssh-add/pam-ssh-add.c \
	src/pam-ssh-add/pam-ssh-add.h \
	$(NULL)

# -----------------------------------------------------------------------------
# pam_ssh_add.so

pam_PROGRAMS = pam_ssh_add.so
pam_ssh_add_so_CFLAGS = -fPIC $(AM_CFLAGS)
pam_ssh_add_so_LDFLAGS = -shared
pam_ssh_add_so_LDADD = $(libpam_ssh_add_a_LIBS)
pam_ssh_add_so_SOURCES = src/pam-ssh-add/pam-ssh-add.c

# -----------------------------------------------------------------------------
# Unit tests

TEST_PROGRAM += test-ssh-add
test_ssh_add_CPPFLAGS = $(TEST_CPP)
test_ssh_add_LDADD = $(libpam_ssh_add_a_LIBS) $(TEST_LIBS)
test_ssh_add_SOURCES = src/pam-ssh-add/test-ssh-add.c

dist_check_DATA += \
	src/pam-ssh-add/mock-ssh-agent \
	src/pam-ssh-add/mock-ssh-add \
	src/pam-ssh-add/mock-environment \
	$(NULL)
