# Cockpit Web Service Container

Atomic contains the Cockpit bridge process, but not the Web Service. This means you can add an Atomic host to another Cockpit dashboard, but not connect to it directly.

If you want to connect directly to your Atomic Host with your web browser, use this privileged container.

Run it like so:

    # atomic run cockpit/ws

And then use your web browser to log into port 9090 on your host IP address as usual.

Important: This expects that Atomic (the host operating system) has the cockpit-bridge executable and cockpit-system package.

## More Info

 * [Cockpit Project](https://cockpit-project.org)
 * [Cockpit Development](https://github.com/cockpit-project/cockpit)
