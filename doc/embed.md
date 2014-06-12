Embedding Cockpit
=================

You can embed Cockpit into a larger web page as a frame.  You can
control some aspects of Cockpit via the URL.

See the file embed-example.html in this directory.

No Dashboard
------------

If you want to confine Cockpit to a single machine, you can omit the
"All" element in the breadcrumb trail.  The user then has no obvious
way to navigate to a different machine.

To achieve this, use a URL like this:

  https://IP:1001/#server
