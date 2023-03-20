# The concrete set of linguas we are using
LINGUAS = $(shell cat $(srcdir)/po/LINGUAS)

# The full list of various input and output file types
PO_LINGUAS = $(addprefix po/,$(LINGUAS))
PO_INPUTS = $(addsuffix .po,$(PO_LINGUAS))

# Extract translate attribute, Glade style, angular-gettext HTML translations
po/cockpit.html.pot: package-lock.json
	$(AM_V_GEN) mkdir -p $(dir $@) && \
	$(srcdir)/pkg/lib/html2po.js -d $(srcdir) -o $@ \
		$$(cd $(srcdir) && find pkg/ -name '*.html')

# Extract cockpit style javascript translations
po/cockpit.js.pot:
	$(AM_V_GEN) mkdir -p $(dir $@) && \
	xgettext --default-domain=cockpit --output=- --language=C --keyword= \
		--keyword=_:1,1t --keyword=_:1c,2,2t --keyword=C_:1c,2 \
		--keyword=N_ --keyword=NC_:1c,2 \
		--keyword=gettext:1,1t --keyword=gettext:1c,2,2t \
		--keyword=ngettext:1,2,3t --keyword=ngettext:1c,2,3,4t \
		--keyword=gettextCatalog.getString:1,3c --keyword=gettextCatalog.getPlural:2,3,4c \
		--from-code=UTF-8 --directory=$(srcdir) \
		$$( cd $(srcdir) && find pkg/ ! -name 'test-*' -name '*.js' -o -name '*.jsx') | \
		sed '/^#/ s/, c-format//' > $@

po/cockpit.manifest.pot: package-lock.json
	$(AM_V_GEN) mkdir -p $(dir $@) && \
	$(srcdir)/pkg/lib/manifest2po.js -d $(srcdir) -o $@ \
		$$(cd $(srcdir) && find pkg/ -name 'manifest.json')

po/cockpit.appstream.pot:
	$(AM_V_GEN) mkdir -p $(dir $@) && \
	GETTEXTDATADIRS=$(srcdir)/po xgettext --output=$@ --directory=$(srcdir) \
		$$(cd $(srcdir) && find pkg/ src/ -name '*.appdata.xml.in' -o -name '*.metainfo.xml.in')

po/cockpit.polkit.pot:
	$(AM_V_GEN) mkdir -p $(dir $@) && \
	GETTEXTDATADIRS=$(srcdir)/po xgettext --output=$@ --directory=$(srcdir) \
		$$(cd $(srcdir) && find src/ -name '*.policy.in')

# Combine the above pot files into one
po/cockpit.pot: po/cockpit.html.pot po/cockpit.js.pot po/cockpit.manifest.pot po/cockpit.appstream.pot po/cockpit.polkit.pot
	$(AM_V_GEN) mkdir -p $(dir $@) && \
	msgcat --sort-output --output-file=$@ $^

CLEANFILES += \
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
