REACT_COMPONENTS = \
	lib/cockpit-components-listing.jsx \
	lib/cockpit-components-select.jsx \
	lib/cockpit-components-terminal.jsx \
	lib/cockpit-components-dialog.jsx \
	$(NULL)

EXTRA_DIST += \
	$(REACT_COMPONENTS) \
	$(lib_TESTS) \
	$(NULL)

update-lib:: update-bower
	$(JSMODULE) -m -d 'jquery' \
	    -o $(srcdir)/lib/flot.js \
	    $(BOWER)/jquery-flot/jquery.flot.js \
	    $(BOWER)/jquery-flot/jquery.flot.selection.js \
	    $(BOWER)/jquery-flot/jquery.flot.time.js \
	    $(NULL)
