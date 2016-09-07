Webpack build output
====================

This directory is populated with the built Cockpit packages when
you run Webpack:

    $ webpack

You can link this directory into your home directory and have
Cockpit on your local machine use the built packages:

    $ mkdir -p ~/.local/share/
    $ ln -s $(pwd)/dist ~/.local/share/cockpit

Make sure to log into Cockpit as the same user on the same local
machine as you are running the commands above.

If you want to setup automatic syncing as you edit javascript files
you can:

    $ webpack --progress --colors --watch
