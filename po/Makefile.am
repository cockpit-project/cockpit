
GETTEXT_PACKAGE = cockpit

# The concrete set of linguas we are using
LINGUAS = $(shell cat $(srcdir)/po/LINGUAS)

WEBLATE_REPO=tmp/weblate-repo
WEBLATE_REPO_URL=https://github.com/cockpit-project/cockpit-weblate.git
WEBLATE_REPO_BRANCH=rhel-8.3

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
	src/bridge/ \
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
	( cd $(srcdir) && find src/base1/ $(TRANSLATE) -name '*.js' -o -name '*.jsx' ) > $@
po/POTFILES.manifest.in:
	$(MKDIR_P) $(notdir $@)
	( cd $(srcdir) && find $(TRANSLATE) -name 'manifest.json.in' ) > $@
po/POTFILES.appstream.in:
	( cd $(srcdir) && find $(TRANSLATE) -name '*.appdata.xml.in' ) > $@
po/POTFILES.polkit.in:
	( cd $(srcdir) && find $(TRANSLATE) -name '*.policy.in' ) > $@
.PHONY: po/POTFILES.c.in po/POTFILES.html.in po/POTFILES.js.in po/POTFILES.manifest.in po/POTFILES.appstream.in po/POTFILES.polkit.in

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
		--keyword=_:1,1t --keyword=_:1c,2,2t --keyword=C_:1c,2 \
		--keyword=N_ --keyword=NC_:1c,2 \
		--keyword=gettext:1,1t --keyword=gettext:1c,2,2t \
		--keyword=ngettext:1,2,3t --keyword=ngettext:1c,2,3,4t \
		--keyword=gettextCatalog.getString:1,3c --keyword=gettextCatalog.getPlural:2,3,4c \
		--from-code=UTF-8 --directory=$(srcdir) --files-from=$^ | \
		sed '/^#/ s/, c-format//' > $@

po/cockpit.manifest.pot: po/POTFILES.manifest.in
	$(srcdir)/tools/missing $(srcdir)/po/manifest2po -d $(srcdir) -f $^ -o $@

po/cockpit.appstream.pot: po/POTFILES.appstream.in
	cd $(srcdir) && $(XGETTEXT) --output=$(abs_builddir)/$@ --files-from=$(abs_builddir)/$^

po/cockpit.polkit.pot: po/POTFILES.polkit.in
	cd $(srcdir) && GETTEXTDATADIRS=$(srcdir)/po $(XGETTEXT) --output=$(abs_builddir)/$@ --files-from=$(abs_builddir)/$^

# Combine the above pot files into one
po/cockpit.pot: po/cockpit.c.pot po/cockpit.html.pot po/cockpit.js.pot po/cockpit.manifest.pot po/cockpit.appstream.pot po/cockpit.polkit.pot
	$(MSGCAT) --sort-output --output-file=$@ $^

# Actually update the old translations with new translatable text
update-po: po/cockpit.pot
	for lang in $(LINGUAS); do \
		$(MSGMERGE) --output-file=$(srcdir)/po/$$lang.po $(srcdir)/po/$$lang.po $<; \
	done

$(WEBLATE_REPO):
	git clone --depth=1 -b $(WEBLATE_REPO_BRANCH) $(WEBLATE_REPO_URL) $(WEBLATE_REPO)

upload-pot: po/cockpit.pot $(WEBLATE_REPO)
	cp $(builddir)/po/cockpit.pot $(WEBLATE_REPO)
	git -C $(WEBLATE_REPO) commit -m "Update source file" -- cockpit.pot
	git -C $(WEBLATE_REPO) push

clean-po:
	rm $(srcdir)/po/*.po

download-po: $(WEBLATE_REPO)
	cp $(WEBLATE_REPO)/*.po $(srcdir)/po/

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
	po/its/polkit.its \
	po/its/polkit.loc \
	$(NULL)
