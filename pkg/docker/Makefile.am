
dockerdir = $(pkgdatadir)/docker
docker_GZ = \
	pkg/docker/bundle.min.js.gz \
	pkg/docker/console.min.html.gz \
	pkg/docker/containers.min.html.gz \
	pkg/docker/docker.min.css.gz \
	pkg/docker/docker.min.js.gz \
	$(NULL)
docker_DATA = \
	pkg/docker/manifest.json \
	$(docker_GZ) \
	$(NULL)

dockerdebugdir = $(debugdir)$(dockerdir)
dockerdebug_DATA = \
	pkg/docker/bundle.js \
	pkg/docker/client.js \
	pkg/docker/details.js \
	pkg/docker/docker.css \
	pkg/docker/docker.js \
	pkg/docker/console.html \
	pkg/docker/containers.html \
	pkg/docker/containers.js \
	pkg/docker/image.js \
	pkg/docker/overview.js \
	pkg/docker/run.js \
	pkg/docker/search.js \
	pkg/docker/util.js \
	$(NULL)

docker_BUNDLE = \
	pkg/docker/client.min.js \
	pkg/docker/details.min.js \
	pkg/docker/docker.min.js \
	pkg/docker/containers.min.js \
	pkg/docker/image.min.js \
	pkg/docker/overview.min.js \
	pkg/docker/run.min.js \
	pkg/docker/search.min.js \
	pkg/docker/util.min.js \
	$(NULL)

pkg/docker/bundle.min.js: $(docker_BUNDLE)
	$(AM_V_GEN) $(srcdir)/tools/missing $(srcdir)/tools/jsbundle $@ $^

docker_TESTS = \
	pkg/docker/test-docker.html \
	$(NULL)

TESTS += $(docker_TESTS)

CLEANFILES += \
	pkg/docker/bundle.min.js \
	pkg/docker/bundle.min.js \
	$(docker_BUNDLE) \
	$(docker_GZ) \
	$(NULL)

EXTRA_DIST += \
	pkg/docker/bundle.min.js \
	pkg/docker/containers.min.html \
	$(docker_DATA) \
	$(dockerdebug_DATA) \
	$(docker_TESTS) \
	$(docker_BUNDLE) \
	$(NULL)
