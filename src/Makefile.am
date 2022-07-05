BUILT_SOURCES =
bin_PROGRAMS =
libexec_PROGRAMS =
libexec_SCRIPTS =
sbin_PROGRAMS =

# -----------------------------------------------------------------------------
#  C

AM_CPPFLAGS = \
	-I$(top_srcdir)/src \
	-DDATADIR=\"$(datadir)\" \
	-DLIBEXECDIR=\""$(libexecdir)"\" \
	-DPACKAGE_SYSCONF_DIR=\""$(sysconfdir)"\" \
	$(NULL)

AM_CFLAGS = \
	-pthread \
	-Wall \
	-Werror=strict-prototypes \
	-Werror=missing-prototypes \
	-Werror=implicit-function-declaration \
	-Werror=pointer-arith -Werror=init-self \
	-Werror=format=2 \
	-Werror=return-type \
	-Werror=missing-include-dirs \
	$(NULL)
