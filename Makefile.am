
SUBDIRS = data src test

ACLOCAL_AMFLAGS = -I m4

EXTRA_DIST = \
	$(PACKAGE).spec \
	$(PACKAGE).spec.in \
	AUTHORS.in \
	HACKING.md \
	README.md \
	$(NULL)

DISTCLEAN_FILES = $(PACKAGE).spec

rpm: clean
	@(unset CDPATH ; $(MAKE) dist && rpmbuild -ta $(distdir).tar.gz)

dist-hook: gen-AUTHORS

# Generate the AUTHORS file (with all entries since the switch to git)
# and insert it into the directory we're about to use to create a tarball.
.PHONY: gen-AUTHORS
gen-AUTHORS:
	$(AM_V_GEN)if test -d $(srcdir)/.git; then                      \
	  out="`cd $(srcdir) && git log --pretty=format:'%aN <%aE>' | sort -u`" && \
	  perl -p -e "s/#authorslist#// and print '$$out'"            \
	    < $(srcdir)/AUTHORS.in > $(distdir)/AUTHORS-tmp &&        \
	  mv -f $(distdir)/AUTHORS-tmp $(distdir)/AUTHORS ;           \
	fi
