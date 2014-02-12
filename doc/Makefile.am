NULL =

EXTRA_DIST = \
	cockpit-transport.svg \
	cockpit-transport.png \
	$(NULL)

# Nothing here
all:

render-images: cockpit-transport.png

cockpit-transport.png: cockpit-transport.svg
	 inkscape --without-gui --export-area-page \
		--export-width=1280 --export-height=960 \
		--export-png=$@ $<
