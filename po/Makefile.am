
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
	$(MSGGREP) `$(FILTER_PO_SRC_WS)` $< > $@.tmp && mv $@.tmp $@

# Build a binary mo file from po
.po.mo:
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(MSGFMT) -o $@.tmp $< && mv $@.tmp $@ && touch $@

# Copy the empty translations to wherever they are needed
%/po.js: po/po.empty.js
	$(COPY_RULE)

# Build a javascript file from a po
po.%.js: %.po
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && \
	$(srcdir)/tools/missing $(srcdir)/po/po2json -m $(srcdir)/po/po.empty.js -o $@.js.tmp $< && \
	mv $@.js.tmp $@

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
	node_modules/registry-image-widgets/ \
	src/ws/ \
	$(NULL)

# Lists of files we need to extract from
po/POTFILES.c.in:
	$(MKDIR_P) $(notdir $@)
	( cd $(srcdir) && find src/ws/ src/bridge/ -name '*.c' ) > $@
po/POTFILES.html.in:
	$(MKDIR_P) $(notdir $@)
	( cd $(srcdir) && find $(TRANSLATE) -name '*.html' ) > $@
po/POTFILES.js.in:
	$(MKDIR_P) $(notdir $@)
	( cd $(srcdir) && find src/base1/ $(TRANSLATE) -name '*.js' -o -name '*.jsx' -o -name '*.es6' ) > $@
po/POTFILES.manifest.in:
	$(MKDIR_P) $(notdir $@)
	( cd $(srcdir) && find $(TRANSLATE) -name 'manifest.json' ) > $@
po/POTFILES.pre.in: prepare-po
	$(MKDIR_P) $(notdir $@)
	( cd tmp/ && find . -type f ) > $@
.PHONY: po/POTFILES.c.in po/POTFILES.html.in po/POTFILES.js.in po/POTFILES.manifest.in po/POTFILES.pre.in

# Extract from GLib based C code files
po/cockpit.c.pot: po/POTFILES.c.in
	$(XGETTEXT) --default-domain=cockpit --output=$@ --language=C \
		--keyword=_ --keyword=N_ --keyword=C_:1c,2 --keyword=NC_:1c,2 --keyword=Q_ \
		--keyword=g_dgettext:2 --keyword=g_dngettext:2,3 --keyword=g_dpgettext:2 \
		--keyword=g_dpgettext2=2c,3 \
		--from-code=UTF-8 --directory=$(srcdir) --files-from=$^

# Extract translate attribute, Glade style, angular-gettext HTML translations
po/cockpit.html.pot: po/POTFILES.html.in
	$(srcdir)/tools/missing $(srcdir)/po/html2po -d $(srcdir) -f $^ -o $@

# Extract cockpit style javascript translations
po/cockpit.js.pot: po/POTFILES.js.in
	$(XGETTEXT) --default-domain=cockpit --output=- --language=C --keyword= \
		--keyword=_:1,1t --keyword=_:1c,2,1t --keyword=C_:1c,2 \
		--keyword=N_ --keyword=NC_:1c,2 \
		--keyword=gettext:1,1t --keyword=gettext:1c,2,2t \
		--keyword=ngettext:1,2,3t --keyword=ngettext:1c,2,3,4t \
		--keyword=gettextCatalog.getString:1,3c --keyword=gettextCatalog.getPlural:2,3,4c \
		--from-code=UTF-8 --directory=$(srcdir) --files-from=$^ | \
		sed '/^#/ s/, c-format//' > $@

po/cockpit.manifest.pot: po/POTFILES.manifest.in
	$(srcdir)/tools/missing $(srcdir)/po/manifest2po -d $(srcdir) -f $^ -o $@

# Extract pre-processed prepare-po data in tmp/
po/cockpit.pre.pot: po/POTFILES.pre.in
	$(XGETTEXT) --default-domain=cockpit --output=$@ \
		--language=C --keyword=N_ \
		--from-code=UTF-8 --directory=$(builddir)/tmp --files-from=$^

# Combine the above pot files into one
po/cockpit.pot: po/cockpit.c.pot po/cockpit.html.pot po/cockpit.js.pot po/cockpit.manifest.pot po/cockpit.pre.pot
	$(MSGCAT) --sort-output --output-file=$@ $^

# Actually update the old translations with new translatable text
update-po: po/cockpit.pot
	for lang in $(LINGUAS); do \
		$(MSGMERGE) --output-file=$(srcdir)/po/$$lang.po $(srcdir)/po/$$lang.po $<; \
	done

ZANATA_CLI = LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 zanata-cli -B

upload-pot: po/cockpit.pot
	$(ZANATA_CLI) push --includes cockpit.pot --project-config "$(srcdir)/po/zanata.xml" \
		-s "$(builddir)/po"

upload-translations:
	$(ZANATA_CLI) push --includes=cockpit.pot --project-config "$(srcdir)/po/zanata.xml" \
		--push-type trans -s "$(builddir)/po" -t "$(srcdir)/po"

download-po:
	$(ZANATA_CLI) pull --includes=cockpit.pot --project-config "$(srcdir)/po/zanata.xml" \
		--min-doc-percent 1 -s "$(builddir)/po" -t "$(srcdir)/po"
	sh -c 'cd $(srcdir)/po; ls *.po' | sed 's/\.po//g' | sort > $(srcdir)/po/LINGUAS

CLEANFILES += \
	$(MO_FILES) \
	$(POJS_FILES) \
	$(nodist_po_DATA) \
	po/POTFILES.*.in \
	dist/shell/*.po \
	src/ws/*.po \
	po/cockpit*.pot \
	po/po.empty.js.gz \
	$(NULL)

EXTRA_DIST += \
	$(PO_INPUTS) \
	po/LINGUAS \
	po/po.empty.js \
	po/po2json \
	po/zanata.xml \
	$(NULL)
