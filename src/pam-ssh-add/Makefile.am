noinst_LIBRARIES += libpam_ssh_add.a

libpam_ssh_add_a_SOURCES = \
	src/pam-ssh-add/pam-ssh-add.c \
	src/pam-ssh-add/pam-ssh-add.h \
	$(NULL)

libpam_ssh_add_a_CFLAGS = $(NULL)

libpam_ssh_add_a_LIBS = \
	libpam_ssh_add.a \
	$(PAM_LIBS)

pam_ssh_add_FILES = src/pam-ssh-add/pam-ssh-add.c src/pam-ssh-add/pam-ssh-add.c
pam_ssh_add.so: libpam_ssh_add.a $(pam_ssh_add_FILES)
	$(AM_V_CCLD) $(CC) -fPIC -shared $(CFLAGS) $(libpam_ssh_add_a_CFLAGS) -I$(builddir) \
		-o $@ $^ $(libpam_ssh_add_a_LIBS) $(LDFLAGS)

all-local:: pam_ssh_add.so

EXTRA_DIST += \
	$(pam_ssh_add_FILES) \
	$(NULL)

CLEANFILES += pam_ssh_add.so

install-exec-local::
	$(MKDIR_P) $(DESTDIR)$(pamdir)
	$(INSTALL) pam_ssh_add.so $(DESTDIR)$(pamdir)
uninstall-local::
	$(RM) -f $(DESTDIR)$(pamdir)/pam_ssh_add.so

# -----------------------------------------------------------------------------
# Tests

PAM_SSH_ADD_CHECKS = \
	test-ssh-add \
	$(NULL)

test_ssh_add_SOURCES = src/pam-ssh-add/test-ssh-add.c
test_ssh_add_CFLAGS = $(libpam_ssh_add_a_CFLAGS)
test_ssh_add_LDADD = $(libpam_ssh_add_a_LIBS) libretest.a

noinst_PROGRAMS += $(PAM_SSH_ADD_CHECKS)
TESTS += $(PAM_SSH_ADD_CHECKS)

EXTRA_DIST += \
	src/pam-ssh-add/mock-ssh-agent \
	src/pam-ssh-add/mock-ssh-add \
	src/pam-ssh-add/mock-environment \
	$(NULL)
