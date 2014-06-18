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

