registry_VIEWS = \
	pkg/registry/views/dashboard-page.html \
	pkg/registry/views/filter-bar.html \
	pkg/registry/views/image-body.html \
	pkg/registry/views/image-config.html \
	pkg/registry/views/image-delete.html \
	pkg/registry/views/image-meta.html \
	pkg/registry/views/image-listing.html \
	pkg/registry/views/image-page.html \
	pkg/registry/views/image-panel.html \
	pkg/registry/views/images-page.html \
	pkg/registry/views/imagestream-body.html \
	pkg/registry/views/imagestream-delete.html \
	pkg/registry/views/imagestream-meta.html \
	pkg/registry/views/imagestream-modify.html \
	pkg/registry/views/imagestream-page.html \
	pkg/registry/views/imagestream-panel.html \
	pkg/registry/views/add-group-dialog.html \
	pkg/registry/views/add-user-dialog.html \
	pkg/registry/views/add-project-dialog.html \
	pkg/registry/views/projects-page.html \
	pkg/registry/views/project-page.html \
	pkg/registry/views/project-panel.html \
	pkg/registry/views/project-listing.html \
	$(NULL)

registry_LESS = \
	pkg/registry/styles/main.less \
	pkg/registry/styles/dashboard.less \
	pkg/registry/styles/dropdown.less \
	pkg/registry/styles/filter.less \
	pkg/registry/styles/images.less \
	pkg/registry/styles/projects.less \
	pkg/registry/styles/sidebar.less \
	pkg/registry/styles/variables-bootstrap.less \
	pkg/registry/styles/variables-patternfly.less \
	$(NULL)

registry_MODULES = \
	pkg/registry/scripts/kube-client.js \
	pkg/registry/scripts/kube-client-cockpit.js \
	pkg/registry/scripts/date.js \
	pkg/registry/scripts/dialog.js \
	pkg/registry/scripts/listing.js \
	pkg/registry/scripts/images.js \
	pkg/registry/scripts/layers.js \
	pkg/registry/scripts/dashboard.js \
	pkg/registry/scripts/projects.js \
	pkg/registry/scripts/main.js \
	$(NULL)

registry_TESTS = \
	pkg/registry/tests/test-kube-client.html \
	pkg/registry/tests/test-images.html \
	pkg/registry/tests/test-projects.html \
	$(NULL)

# Typically only modify stuff above this line

registrydir = $(pkgdatadir)/registry
nodist_registry_DATA = \
	pkg/registry/index.min.html.gz \
	pkg/registry/bundle.min.js.gz \
	pkg/registry/bundle.min.css.gz \
	$(NULL)
registry_DATA = \
 	pkg/registry/manifest.json \
	pkg/registry/sparkle-placeholder.png \
	pkg/registry/donut-placeholder.png \
	$(NULL)

registrydebugdir = $(debugdir)$(registrydir)
registrydebug_DATA = \
	pkg/registry/bundle.js \
	pkg/registry/bundle.css \
	pkg/registry/index.html \
	pkg/registry/less.js \
	pkg/registry/override.json \
	$(NULL)

install-data-hook::
	mkdir -p $(DESTDIR)$(registrydebugdir)
	tar -chf - -C $(srcdir) $(registry_VIEWS) $(registry_LESS) $(registry_MODULES) | tar -xf - --strip-components=2 -C $(DESTDIR)$(registrydebugdir)

uninstall-hook:
	rm -rf $(DESTDIR)$(registrydebugdir)/scripts
	rm -rf $(DESTDIR)$(registrydebugdir)/views
	rm -rf $(DESTDIR)$(registrydebugdir)/styles

registry_MIN = $(registry_MODULES:.js=.min.js)

registry_BUNDLE = \
	$(registry_MIN) \
	$(NULL)

# Bundles all the view templates into a $templateCache loadable
pkg/registry/templates.js: $(registry_VIEWS)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/ngbundle -m registry -o $@ $^

# Everything else into a nice big bundle
pkg/registry/bundle.min.js: $(registry_BUNDLE) pkg/registry/templates.js
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

# Less is compiled correctly
pkg/registry/bundle.min.css: $(registry_LESS)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/lessc $< $@

TESTS += $(registry_TESTS)

CLEANFILES += \
	pkg/registry/registry.min.css \
	pkg/registry/index.min.html \
	pkg/registry/bundle.min.js \
	pkg/registry/templates.js \
	pkg/registry/bundle.min.css \
	$(registry_MIN) \
	$(nodist_registry_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/registry/bundle.min.css \
	pkg/registry/index.min.html \
	pkg/registry/bundle.min.js \
	pkg/registry/templates.js \
	pkg/registry/scripts/kube-client-mock.js \
	pkg/registry/tests/fixture-basic.js \
	pkg/registry/tests/fixture-large.js \
	$(registry_BOWER) \
	$(registry_LESS) \
	$(registry_BUNDLE) \
	$(registry_MODULES) \
	$(registry_DATA) \
	$(registrydebug_DATA) \
	$(registry_TESTS) \
	$(registry_VIEWS) \
	$(NULL)
