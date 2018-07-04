SUBDIRS = \
	data \
	docs \
	src \
	tests \
	$(NULL)

ACLOCAL_AMFLAGS = -I m4

EXTRA_DIST = \
	$(PACKAGE).spec \
	$(PACKAGE).spec.in \
	AUTHORS.in \
	HACKING.md \
	README.md \
	$(NULL)

DISTCLEAN_FILES = \
	$(PACKAGE).spec \
	$(NULL)

rpm: clean
	@(unset CDPATH ; $(MAKE) dist && rpmbuild -ta $(distdir).tar.xz)

dist-hook: gen-AUTHORS

# Generate the AUTHORS file (with all entries since the switch to git)
# and insert it into the directory we're about to use to create a tarball.
.PHONY: gen-AUTHORS
gen-AUTHORS:
	$(AM_V_GEN)\
	if test -d $(srcdir)/.git; then \
	  ( \
	    cd $(srcdir) && \
	    git log --pretty=format:'    %aN <%aE>' | sort -u \
	  ) > all.list && \
	  sort -u $(srcdir)/AUTHORS.in > maint.list && \
	  comm -23 all.list maint.list > contrib.list && \
	  contrib="`cat contrib.list`" && \
	  perl -p -e "s/#contributorslist#// and print '$$contrib'" \
	    < $(srcdir)/AUTHORS.in > $(distdir)/AUTHORS-tmp && \
	  mv -f $(distdir)/AUTHORS-tmp $(distdir)/AUTHORS && \
	  rm -f all.list maint.list contrib.list; \
	fi
