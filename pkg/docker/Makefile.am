
dockerdir = $(pkgdatadir)/docker
nodist_docker_DATA = \
	pkg/docker/bundle.min.js.gz \
	pkg/docker/console.min.html.gz \
	pkg/docker/docker.min.css.gz \
	pkg/docker/docker.min.js.gz \
	pkg/docker/index.min.html.gz \
	$(NULL)
docker_DATA = \
	pkg/docker/manifest.json \
	$(NULL)

dockerdebugdir = $(debugdir)$(dockerdir)
dockerdebug_DATA = \
	pkg/docker/bundle.js \
	pkg/docker/bar.js \
	pkg/docker/client.js \
	pkg/docker/details.js \
	pkg/docker/docker.css \
	pkg/docker/docker.js \
	pkg/docker/console.html \
	pkg/docker/containers.js \
	pkg/docker/image.js \
	pkg/docker/index.html \
	pkg/docker/mustache.js \
	pkg/docker/patterns.js \
	pkg/docker/overview.js \
	pkg/docker/run.js \
	pkg/docker/search.js \
	pkg/docker/term.js \
	pkg/docker/term.css \
	pkg/docker/util.js \
	$(NULL)

docker_BUNDLE = \
	pkg/docker/bar.min.js \
	pkg/docker/client.min.js \
	pkg/docker/details.min.js \
	pkg/docker/docker.min.js \
	pkg/docker/containers.min.js \
	pkg/docker/image.min.js \
	pkg/docker/mustache.min.js \
	pkg/docker/patterns.min.js \
	pkg/docker/overview.min.js \
	pkg/docker/run.min.js \
	pkg/docker/search.min.js \
	pkg/docker/term.min.js \
	pkg/docker/util.min.js \
	$(NULL)

pkg/docker/bundle.min.js: $(docker_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

# Ugliness to be solved by webpack in the future
pkg/docker/mustache.min.js: pkg/docker/mustache.js
	$(MIN_JS_RULE)
pkg/docker/term.min.js: pkg/docker/term.js
	$(MIN_JS_RULE)

docker_TESTS = \
	pkg/docker/test-docker.html \
	$(NULL)

TESTS += $(docker_TESTS)

CLEANFILES += \
	pkg/docker/bundle.min.js \
	pkg/docker/console.min.html \
	pkg/docker/docker.min.css \
	pkg/docker/index.min.html \
	$(docker_BUNDLE) \
	$(nodist_docker_DATA) \
	$(NULL)

EXTRA_DIST += \
	pkg/docker/bundle.min.js \
	pkg/docker/console.min.html \
	pkg/docker/docker.min.css \
	pkg/docker/index.min.html \
	$(docker_BUNDLE) \
	$(NULL)
