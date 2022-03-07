noinst_LIBRARIES += libpam_ssh_add.a

libpam_ssh_add_a_SOURCES = \
	src/common/cockpitmemory.h \
	src/common/cockpitmemory.c \
	src/pam-ssh-add/pam-ssh-add.c \
	src/pam-ssh-add/pam-ssh-add.h \
	$(NULL)

libpam_ssh_add_a_CFLAGS = -fPIC

libpam_ssh_add_a_LIBS = \
	libpam_ssh_add.a \
	$(PAM_LIBS)

pam_PROGRAMS = pam_ssh_add.so
pam_ssh_add_so_SOURCES = src/pam-ssh-add/pam-ssh-add.c
pam_ssh_add_so_CFLAGS = -fPIC
pam_ssh_add_so_LDFLAGS = -shared
pam_ssh_add_so_LDADD = $(libpam_ssh_add_a_LIBS)

# -----------------------------------------------------------------------------
# Tests

PAM_SSH_ADD_CHECKS = \
	test-ssh-add \
	$(NULL)

test_ssh_add_SOURCES = src/pam-ssh-add/test-ssh-add.c
test_ssh_add_LDADD = $(libpam_ssh_add_a_LIBS) libretest.a

check_PROGRAMS += $(PAM_SSH_ADD_CHECKS)
TESTS += $(PAM_SSH_ADD_CHECKS)

EXTRA_DIST += \
	src/pam-ssh-add/mock-ssh-agent \
	src/pam-ssh-add/mock-ssh-add \
	src/pam-ssh-add/mock-environment \
	$(NULL)
