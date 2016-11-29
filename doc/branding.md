# Branding

Typically Cockpit is branded in such a way that it looks like the admin
user interface for an operating system. The "Cockpit" brand is only used
during development.

Due to trademark law, as a general rule Cockpit does not ship logos for
operating systems in its packaging. These are expected to be present on the
system itself, and are incorporated into the branding.

## How Cockpit Selects Branding

In ```$prefix/share/cockpit/branding``` are multiple directories, each of which
contain branding information. Branding files are served from the directories
based in the order below, if a file is not present in the first directory on
the list, the second will be consulted, and so on.

    $prefix/share/cockpit/branding/$ID-$VARIANT_ID
    $prefix/share/cockpit/branding/$ID
    $prefix/share/cockpit/branding/default
    $prefix/share/cockpit/static

The ```$ID``` and ```$VARIANT_ID``` variables are those listed in ```/etc/os-release```,
and ```$prefix``` is usually ```/usr```.

All of the files served from these directories are available over HTTP
without authentication. This is required since these resources will be used
on the login screen.

## Branding files

The following files are interesting in the above directories for branding
purposes:

    apple-touch-icon.png
    favicon.ico
    branding.css

In addition there are image files refered to by branding.css (see below).
Since Cockpit does not package trademarked logos, typically there will be
symlinks from a branding directory to the relevant image files elsewhere
on the system.

## Branding Styles

The Cockpit login screen and navigation area loads a ```branding.css``` file
from the above directories.

The branding.css file should override the following areas of the login screen:

    /* Background of the login prompt */
    body.login-pf {
        background: url("my-background-image.jpg");
        background-size: auto;
    }

    /* Upper right logo of login screen */
    #badge {
        width: 225px;
        height: 80px;
        background-image: url("logo.png");
        background-size: contain;
        background-repeat: no-repeat;
    }

    /* The brand text above the login fields */
    #brand {
        font-size: 18pt;
        text-transform: uppercase;
        content: "${NAME} <b>${VARIANT}</b>";
    }

The ```branding.css``` file should override the following areas of the navigation bar:

    /* The text in the upper left corner of logged in Cockpit
    #index-brand {
        content: "${NAME} <b>${VARIANT}</b>";
    }

Notice how we can use variables from ```/etc/os-release``` in the branding.
The value for these variables come from the machine that cockpit is logged into.
