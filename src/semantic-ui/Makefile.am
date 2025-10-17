# Mustache is distributed for compat reasons

semanticdir = $(pkgdatadir)/semantic-ui
semantic_DATA = \
	dist/semantic-ui/semantic.min.css.gz \
	dist/semantic-ui/semantic.min.js.gz \
	dist/semantic-ui/manifest.json \
	$(NULL)

dist/semantic-ui/manifest.json: src/semantic-ui/manifest.json
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && cp $< $@

dist/semantic-ui/googleApi/googleapi.min.css.gz: src/semantic-ui/googleApi/googleapi.min.css
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && gzip -n -c $< > $@

dist/semantic-ui/themes/github/assets/fonts/octicons-local.ttf:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/github/assets/fonts/octicons-local.ttf $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/github/assets/fonts/octicons.svg:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/github/assets/fonts/octicons.svg $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/github/assets/fonts/octicons.ttf:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/github/assets/fonts/octicons.ttf $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/github/assets/fonts/octicons.woff:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/github/assets/fonts/octicons.woff $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/default/assets/images/flags.png:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/default/assets/images/flags.png $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/default/assets/fonts/icons.woff:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/default/assets/fonts/icons.woff $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/default/assets/fonts/icons.woff2:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/default/assets/fonts/icons.woff2 $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/default/assets/fonts/icons.eot:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/default/assets/fonts/icons.eot $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/default/assets/fonts/outline-icons.woff:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/default/assets/fonts/outline-icons.woff $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/default/assets/fonts/outline-icons.woff2:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/default/assets/fonts/outline-icons.woff2 $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/default/assets/fonts/outline-icons.eot:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/default/assets/fonts/outline-icons.eot $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/default/assets/fonts/brand-icons.woff:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/default/assets/fonts/brand-icons.woff $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/default/assets/fonts/brand-icons.woff2:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/default/assets/fonts/brand-icons.woff2 $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/default/assets/fonts/brand-icons.eot:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/default/assets/fonts/brand-icons.eot $@.tmp && mv $@.tmp $@
	
dist/semantic-ui/themes/material/assets/fonts/icons.woff:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/material/assets/fonts/icons.woff $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/material/assets/fonts/icons.woff2:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/material/assets/fonts/icons.woff2 $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/material/assets/fonts/icons.eot:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/material/assets/fonts/icons.eot $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/basic/assets/fonts/icons.woff:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/basic/assets/fonts/icons.woff $@.tmp && mv $@.tmp $@

dist/semantic-ui/themes/basic/assets/fonts/icons.eot:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/themes/basic/assets/fonts/icons.eot $@.tmp && mv $@.tmp $@

dist/semantic-ui/googleApi/fonts/gstatic/lato_S6u8w4BMUTPHjxsAUi-qJCY.woff2:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/googleApi/fonts/gstatic/lato_S6u8w4BMUTPHjxsAUi-qJCY.woff2 $@.tmp && mv $@.tmp $@

dist/semantic-ui/googleApi/fonts/gstatic/lato_S6u8w4BMUTPHjxsAXC-q.woff2:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/googleApi/fonts/gstatic/lato_S6u8w4BMUTPHjxsAXC-q.woff2 $@.tmp && mv $@.tmp $@

dist/semantic-ui/googleApi/fonts/gstatic/lato_S6u9w4BMUTPHh6UVSwaPGR_p.woff2:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/googleApi/fonts/gstatic/lato_S6u9w4BMUTPHh6UVSwaPGR_p.woff2 $@.tmp && mv $@.tmp $@

dist/semantic-ui/googleApi/fonts/gstatic/lato_S6u9w4BMUTPHh6UVSwiPGQ.woff2:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/googleApi/fonts/gstatic/lato_S6u9w4BMUTPHh6UVSwiPGQ.woff2 $@.tmp && mv $@.tmp $@

dist/semantic-ui/googleApi/fonts/gstatic/lato_S6u_w4BMUTPHjxsI5wq_FQft1dw.woff2:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/googleApi/fonts/gstatic/lato_S6u_w4BMUTPHjxsI5wq_FQft1dw.woff2 $@.tmp && mv $@.tmp $@

dist/semantic-ui/googleApi/fonts/gstatic/lato_S6u_w4BMUTPHjxsI5wq_Gwft.woff2:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/googleApi/fonts/gstatic/lato_S6u_w4BMUTPHjxsI5wq_Gwft.woff2 $@.tmp && mv $@.tmp $@

dist/semantic-ui/googleApi/fonts/gstatic/lato_S6uyw4BMUTPHjx4wXg.woff2:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/googleApi/fonts/gstatic/lato_S6uyw4BMUTPHjx4wXg.woff2 $@.tmp && mv $@.tmp $@

dist/semantic-ui/googleApi/fonts/gstatic/lato_S6uyw4BMUTPHjxAwXjeu.woff2:
	$(V_COPY) $(MKDIR_P) $(dir $@) && \
	cp $(srcdir)/src/semantic-ui/googleApi/fonts/gstatic/lato_S6uyw4BMUTPHjxAwXjeu.woff2 $@.tmp && mv $@.tmp $@

semanticcomponentsdir = $(pkgdatadir)/semantic-ui/components
semanticcomponents_DATA = \
	dist/semantic-ui/components/accordion.min.css.gz \
	dist/semantic-ui/components/accordion.min.js.gz \
	dist/semantic-ui/components/ad.min.css.gz \
	dist/semantic-ui/components/api.min.js.gz \
	dist/semantic-ui/components/breadcrumb.min.css.gz \
	dist/semantic-ui/components/button.min.css.gz \
	dist/semantic-ui/components/card.min.css.gz \
	dist/semantic-ui/components/checkbox.min.css.gz \
	dist/semantic-ui/components/checkbox.min.js.gz \
	dist/semantic-ui/components/comment.min.css.gz \
	dist/semantic-ui/components/container.min.css.gz \
	dist/semantic-ui/components/dimmer.min.css.gz \
	dist/semantic-ui/components/dimmer.min.js.gz \
	dist/semantic-ui/components/divider.min.css.gz \
	dist/semantic-ui/components/dropdown.min.css.gz \
	dist/semantic-ui/components/dropdown.min.js.gz \
	dist/semantic-ui/components/embed.min.css.gz \
	dist/semantic-ui/components/embed.min.js.gz \
	dist/semantic-ui/components/feed.min.css.gz \
	dist/semantic-ui/components/flag.min.css.gz \
	dist/semantic-ui/components/form.min.css.gz \
	dist/semantic-ui/components/form.min.js.gz \
	dist/semantic-ui/components/grid.min.css.gz \
	dist/semantic-ui/components/header.min.css.gz \
	dist/semantic-ui/components/icon.min.css.gz \
	dist/semantic-ui/components/image.min.css.gz \
	dist/semantic-ui/components/input.min.css.gz \
	dist/semantic-ui/components/item.min.css.gz \
	dist/semantic-ui/components/label.min.css.gz \
	dist/semantic-ui/components/list.min.css.gz \
	dist/semantic-ui/components/loader.min.css.gz \
	dist/semantic-ui/components/menu.min.css.gz \
	dist/semantic-ui/components/message.min.css.gz \
	dist/semantic-ui/components/modal.min.css.gz \
	dist/semantic-ui/components/modal.min.js.gz \
	dist/semantic-ui/components/nag.min.css.gz \
	dist/semantic-ui/components/nag.min.js.gz \
	dist/semantic-ui/components/placeholder.min.css.gz \
	dist/semantic-ui/components/popup.min.css.gz \
	dist/semantic-ui/components/popup.min.js.gz \
	dist/semantic-ui/components/progress.min.css.gz \
	dist/semantic-ui/components/progress.min.js.gz \
	dist/semantic-ui/components/rail.min.css.gz \
	dist/semantic-ui/components/rating.min.css.gz \
	dist/semantic-ui/components/rating.min.js.gz \
	dist/semantic-ui/components/reset.min.css.gz \
	dist/semantic-ui/components/reveal.min.css.gz \
	dist/semantic-ui/components/search.min.css.gz \
	dist/semantic-ui/components/search.min.js.gz \
	dist/semantic-ui/components/segment.min.css.gz \
	dist/semantic-ui/components/shape.min.css.gz \
	dist/semantic-ui/components/shape.min.js.gz \
	dist/semantic-ui/components/sidebar.min.css.gz \
	dist/semantic-ui/components/sidebar.min.js.gz \
	dist/semantic-ui/components/site.min.css.gz \
	dist/semantic-ui/components/site.min.js.gz \
	dist/semantic-ui/components/statistic.min.css.gz \
	dist/semantic-ui/components/step.min.css.gz \
	dist/semantic-ui/components/sticky.min.css.gz \
	dist/semantic-ui/components/sticky.min.js.gz \
	dist/semantic-ui/components/tab.min.css.gz \
	dist/semantic-ui/components/tab.min.js.gz \
	dist/semantic-ui/components/table.min.css.gz \
	dist/semantic-ui/components/transition.min.css.gz \
	dist/semantic-ui/components/transition.min.js.gz \
	dist/semantic-ui/components/visibility.min.js.gz \
	$(NULL)

semanticdefaultimagesdir = $(pkgdatadir)/semantic-ui/themes/default/assets/images
semanticdefaultimages_DATA = \
	dist/semantic-ui/themes/default/assets/images/flags.png \
	$(NULL)

semanticdefaultfontsdir = $(pkgdatadir)/semantic-ui/themes/default/assets/fonts
semanticdefaultfonts_DATA = \
	dist/semantic-ui/themes/default/assets/fonts/icons.woff \
	dist/semantic-ui/themes/default/assets/fonts/icons.woff2 \
	dist/semantic-ui/themes/default/assets/fonts/icons.eot \
	dist/semantic-ui/themes/default/assets/fonts/outline-icons.woff \
	dist/semantic-ui/themes/default/assets/fonts/outline-icons.woff2 \
	dist/semantic-ui/themes/default/assets/fonts/outline-icons.eot \
	dist/semantic-ui/themes/default/assets/fonts/brand-icons.woff \
	dist/semantic-ui/themes/default/assets/fonts/brand-icons.woff2 \
	dist/semantic-ui/themes/default/assets/fonts/brand-icons.eot \
	$(NULL)

semanticgithubfontsdir = $(pkgdatadir)/semantic-ui/themes/github/assets/fonts
semanticgithubfonts_DATA = \
	dist/semantic-ui/themes/github/assets/fonts/octicons-local.ttf \
	dist/semantic-ui/themes/github/assets/fonts/octicons.svg \
	dist/semantic-ui/themes/github/assets/fonts/octicons.ttf \
	dist/semantic-ui/themes/github/assets/fonts/octicons.woff \
	$(NULL)

semanticmaterialfontsdir = $(pkgdatadir)/semantic-ui/themes/material/assets/fonts
semanticmaterialfonts_DATA = \
	dist/semantic-ui/themes/material/assets/fonts/icons.woff \
	dist/semantic-ui/themes/material/assets/fonts/icons.woff2 \
	dist/semantic-ui/themes/material/assets/fonts/icons.eot \
	$(NULL)

semanticbasicfontsdir = $(pkgdatadir)/semantic-ui/themes/basic/assets/fonts
semanticbasicfonts_DATA = \
	dist/semantic-ui/themes/basic/assets/fonts/icons.woff \
	dist/semantic-ui/themes/basic/assets/fonts/icons.eot \
	$(NULL)

googleapidir = $(pkgdatadir)/semantic-ui/googleApi/
googleapi_DATA = \
	dist/semantic-ui/googleApi/googleapi.min.css.gz \
	$(NULL)

dist/semantic-ui/semantic.min.js.gz: src/semantic-ui/semantic.min.js
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && gzip -n -c $< > $@

dist/semantic-ui/semantic.min.css.gz: src/semantic-ui/semantic.min.css
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && gzip -n -c $< > $@

dist/semantic-ui/components/%.min.css.gz: src/semantic-ui/components/%.min.css
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && gzip -n -c $< > $@

dist/semantic-ui/components/%.min.js.gz: src/semantic-ui/components/%.min.js
	$(AM_V_GEN) $(MKDIR_P) $(dir $@) && gzip -n -c $< > $@

EXTRA_DIST += \
	dist/semantic-ui/semantic.min.js.gz \
	dist/semantic-ui/semantic.min.css.gz \
	dist/semantic-ui/manifest.json \
	$(semantic_DATA) \
	$(googleapi_DATA) \
	$(googleapifonts_DATA) \
	$(semanticcomponents_DATA) \
	$(semanticbasicfonts_DATA) \
	$(semanticdefaultfonts_DATA) \
	$(semanticdefaultimages_DATA) \
	$(semanticgithubfonts_DATA) \
	$(semanticmaterialfonts_DATA) \
	$(semantic_DATA) \
	$(semanticfonts_DATA) \
	$(semantic_TESTS_JAVASCRIPT) \
	$(NULL)

CLEANFILES += \
	dist/semantic-ui/semantic.min.js.gz \
	dist/semantic-ui/semantic.min.css.gz \
	dist/semantic-ui/manifest.json \
	$(semantic_DATA) \
	$(googleapi_DATA) \
	$(googleapifonts_DATA) \
	$(semanticcomponents_DATA) \
	$(semanticbasicfonts_DATA) \
	$(semanticdefaultfonts_DATA) \
	$(semanticdefaultimages_DATA) \
	$(semanticgithubfonts_DATA) \
	$(semanticmaterialfonts_DATA) \
	$(semantic_DATA) \
	$(semanticfonts_DATA) \
	$(semantic_TESTS_JAVASCRIPT) \
	$(NULL)

# Ensure all semantic-ui targets are built in the correct order
all-local: $(semantic_DATA) $(semanticcomponents_DATA) $(googleapi_DATA) $(googleapifonts_DATA)
	$(MKDIR_P) dist/semantic-ui/googleApi/fonts/gstatic
	if [ ! -f dist/semantic-ui/googleApi/googleapi.min.css.gz ]; then \
		gzip -n -c $(srcdir)/src/semantic-ui/googleApi/googleapi.css > dist/semantic-ui/googleApi/googleapi.min.css.gz; \
	fi
	if [ ! -f dist/semantic-ui/googleApi/fonts/gstatic/lato_S6uyw4BMUTPHjx4wXg.woff2 ]; then \
		cp $(srcdir)/src/semantic-ui/googleApi/fonts/gstatic/*.woff2 dist/semantic-ui/googleApi/fonts/gstatic/; \
	fi

# Create googleApi files after the dist directory is created
dist-hook:
	$(MKDIR_P) dist/semantic-ui/googleApi/fonts/gstatic
	gzip -n -c $(srcdir)/src/semantic-ui/googleApi/googleapi.css > dist/semantic-ui/googleApi/googleapi.min.css.gz
	cp $(srcdir)/src/semantic-ui/googleApi/fonts/gstatic/*.woff2 dist/semantic-ui/googleApi/fonts/gstatic/