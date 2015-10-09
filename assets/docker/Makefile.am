
dockerdir = $(pkgdatadir)/docker
nodist_docker_DATA = \
	assets/docker/bundle.min.js.gz \
	assets/docker/console.min.html.gz \
	assets/docker/docker.min.css.gz \
	assets/docker/docker.min.js.gz \
	assets/docker/index.min.html.gz \
	$(NULL)
docker_DATA = \
	assets/docker/manifest.json \
	$(NULL)

dockerdebugdir = $(debugdir)$(dockerdir)
dockerdebug_DATA = \
	assets/docker/bundle.js \
	assets/docker/client.js \
	assets/docker/details.js \
	assets/docker/docker.css \
	assets/docker/docker.js \
	assets/docker/console.html \
	assets/docker/containers.js \
	assets/docker/image.js \
	assets/docker/index.html \
	assets/docker/overview.js \
	assets/docker/run.js \
	assets/docker/search.js \
	assets/docker/util.js \
	$(NULL)

docker_BUNDLE = \
	assets/docker/client.min.js \
	assets/docker/details.min.js \
	assets/docker/docker.min.js \
	assets/docker/containers.min.js \
	assets/docker/image.min.js \
	assets/docker/overview.min.js \
	assets/docker/run.min.js \
	assets/docker/search.min.js \
	assets/docker/util.min.js \
	$(NULL)

assets/docker/bundle.min.js: $(docker_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

docker_TESTS = \
	assets/docker/test-docker.html \
	$(NULL)

TESTS += $(docker_TESTS)

CLEANFILES += \
	assets/docker/bundle.min.js \
	$(docker_BUNDLE) \
	$(nodist_docker_DATA) \
	$(NULL)

EXTRA_DIST += \
	assets/docker/bundle.min.js \
	assets/docker/console.min.html \
	assets/docker/docker.min.css \
	assets/docker/index.min.html \
	$(docker_DATA) \
	$(dockerdebug_DATA) \
	$(docker_TESTS) \
	$(docker_BUNDLE) \
	$(NULL)
