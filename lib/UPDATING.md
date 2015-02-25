## Replacing Files

 * Make sure to have the version number in the filename in the form
   of 'name.v0.1.ext'
 * After replacing the files, run the following command to link and or
   build the files into the various packages.

    $ make update-lib


## Updating Patternfly

Right now, it's a manual process.

Cockpit uses a different directory layout than Patternfly and you need
to adjust some paths in `patternfly/less/variables.less`:

    @icon-font-path:  "fonts";
    @fa-font-path:    "fonts";
    @font-path:       "fonts";
    @img-path:        "images";

Then rebuild Patternfly and copy the files you need into `./lib/`,
`./lib/images/`, and `./lib/fonts/`, as appropriate.

