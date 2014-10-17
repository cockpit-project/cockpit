
dockerdir = $(pkgdatadir)/docker
nodist_docker_DATA = \
	pkg/docker/docker.min.js
docker_DATA = \
	pkg/docker/docker.js \
	pkg/docker/manifest.json \
	$(NULL)

CLEANFILES += \
	pkg/docker/docker.min.js \
	$(NULL)

EXTRA_DIST += \
	$(docker_DATA) \
	$(NULL)
