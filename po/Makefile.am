# Defaults for standalone operation
srcdir ?= .
AM_DEFAULT_VERBOSITY ?= 0
MKDIR_P ?= mkdir -p

AM_V_GEN ?= $(AM_V_GEN_$(V))
AM_V_GEN_ ?= $(AM_V_GEN_$(AM_DEFAULT_VERBOSITY))
AM_V_GEN_0 ?= @echo "  GEN " $@;

GETTEXT_PACKAGE = cockpit

# The concrete set of linguas we are using
LINGUAS = $(shell cat $(srcdir)/po/LINGUAS)

# The full list of various input and output file types
PO_LINGUAS = $(addprefix po/,$(LINGUAS))
PO_INPUTS = $(addsuffix .po,$(PO_LINGUAS))
MO_FILES = $(addprefix src/ws/,$(addsuffix .mo,$(LINGUAS)))

# Used to list files in src/ws in the po file
FILTER_PO_SRC_WS = sed -ne 's|.*\(\(\.\./\)\?src/ws/[^:]\+\).*|-N \1|p' $<

# A filtered po file with just src/ws
src/ws/%.po: po/%.po
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	msggrep `$(FILTER_PO_SRC_WS)` $< > $@.tmp && mv $@.tmp $@

# Build a binary mo file from po
.po.mo:
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	msgfmt -o $@.tmp $< && mv $@.tmp $@ && touch $@

# Always build the binary gettext data
all-local:: $(MO_FILES)

# Called to install the binary gettext data
install-data-local:: $(MO_FILES)
	for lang in $(LINGUAS); do \
		$(MKDIR_P) $(DESTDIR)$(localedir)/$$lang/LC_MESSAGES; \
		$(INSTALL_DATA) src/ws/$$lang.mo $(DESTDIR)$(localedir)/$$lang/LC_MESSAGES/$(GETTEXT_PACKAGE).mo; \
	done

# Called to ininstall the binary gettext data
uninstall-local::
	for lang in $(LINGUAS); do rm -f $(DESTDIR)$(localedir)/$$lang/LC_MESSAGES/$(GETTEXT_PACKAGE).mo; done

# General code packages to translate
TRANSLATE = \
	pkg/ \
	src/bridge/ \
	src/ws/ \
	$(NULL)

# Extract from GLib based C code files
po/cockpit.c.pot:
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	xgettext --default-domain=cockpit --output=$@ --language=C \
		--keyword=_ --keyword=N_ --keyword=C_:1c,2 --keyword=NC_:1c,2 --keyword=Q_ \
		--keyword=g_dgettext:2 --keyword=g_dngettext:2,3 --keyword=g_dpgettext:2 \
		--keyword=g_dpgettext2=2c,3 \
		--from-code=UTF-8 --directory=$(srcdir) $$(cd $(srcdir) && find src/ws/ src/bridge/ -name '*.c')

# Extract translate attribute, Glade style, angular-gettext HTML translations
po/cockpit.html.pot: package-lock.json
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/pkg/lib/html2po -d $(srcdir) -o $@ \
		$$(cd $(srcdir) && find $(TRANSLATE) -name '*.html')

# Extract cockpit style javascript translations
po/cockpit.js.pot:
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	xgettext --default-domain=cockpit --output=- --language=C --keyword= \
		--keyword=_:1,1t --keyword=_:1c,2,2t --keyword=C_:1c,2 \
		--keyword=N_ --keyword=NC_:1c,2 \
		--keyword=gettext:1,1t --keyword=gettext:1c,2,2t \
		--keyword=ngettext:1,2,3t --keyword=ngettext:1c,2,3,4t \
		--keyword=gettextCatalog.getString:1,3c --keyword=gettextCatalog.getPlural:2,3,4c \
		--from-code=UTF-8 --directory=$(srcdir) \
		$$( cd $(srcdir) && find $(TRANSLATE) ! -name 'test-*' -name '*.js' -o -name '*.jsx') | \
		sed '/^#/ s/, c-format//' > $@

po/cockpit.manifest.pot: package-lock.json
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/pkg/lib/manifest2po -d $(srcdir) -o $@ \
		$$(cd $(srcdir) && find $(TRANSLATE) -name 'manifest.json')

po/cockpit.appstream.pot:
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	GETTEXTDATADIRS=$(srcdir)/po xgettext --output=$@ --directory=$(srcdir) \
		$$(cd $(srcdir) && find $(TRANSLATE) -name '*.appdata.xml.in')

po/cockpit.polkit.pot:
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	GETTEXTDATADIRS=$(srcdir)/po xgettext --output=$@ --directory=$(srcdir) \
		$$(cd $(srcdir) && find $(TRANSLATE) -name '*.policy.in')

# Combine the above pot files into one
po/cockpit.pot: po/cockpit.c.pot po/cockpit.html.pot po/cockpit.js.pot po/cockpit.manifest.pot po/cockpit.appstream.pot po/cockpit.polkit.pot
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	msgcat --sort-output --output-file=$@ $^

CLEANFILES += \
	$(MO_FILES) \
	$(POJS_FILES) \
	$(nodist_po_DATA) \
	dist/shell/*.po \
	src/ws/*.po \
	po/cockpit*.pot \
	$(NULL)

EXTRA_DIST += \
	$(PO_INPUTS) \
	po/LINGUAS \
	po/its/polkit.its \
	po/its/polkit.loc \
	$(NULL)
