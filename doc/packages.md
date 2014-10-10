Cockpit Packages
================

Note: This is initial internal Cockpit developer documentation.

Public documentation: http://files.cockpit-project.org/guide/packages.html

Loading
-------

See doc/protocol.md for how package resources are loaded.

Environment
-----------

Internally the package data is transferred to the javascript side via
a JSON block, called the environment. The environment contains
information about the login, cockpit itself, and the packages installed.

Before login the environment contains the following information, and
is included in HTML data served with the '/' request.

    {
        "localhost": {
            "hostname": "host.example.com",
            "languages": { "de" : { "name": "German" } },
        }
    }

Once the user logs in, the environment is expanded to the following,
and is returned from the '/login' request as JSON.

    {
        "user": "scruffy",
        "name": "Scruffy the Janitor",
        "localhost": {
            "hostname": "host.example.com",
            "languages": { "de" : { "name": "German" } },
            "version": "0.10",
            "build-info": "Built at ...",
            "packages": { ... }
        }
    }
