/* global cockpit, test */

        test.assert(typeof jQuery === "undefined", "jQuery is not defined");
        test.assert(typeof $ === "undefined", "$ is not defined");
        test.assert(typeof cockpit === "object", "cockpit is defined");
        test.assert(cockpit.channel !== undefined, "cockpit.channel is defined");
        test.assert(cockpit.spawn !== undefined, "cockpit.spawn is defined");

        /* Actually try to do something useful */
        var got_message = false;
        var channel = cockpit.channel({"payload": "stream", "spawn": ["sh", "-c", "echo hello"]});
        channel.onmessage = function(ev) {
            got_message = true;
            test.assert(ev.detail === "hello\n", "channel message correct");
            channel.onmessage = null;
        };
        channel.onclose = function(ev) {
            test.assert(ev.detail.command === "close", "channel close data correct");
            if (ev.detail.problem == "no-cockpit") {
                test.skip("not running with a server");
                test.done(7);
            } else {
                test.assert(got_message, "channel got message");
                test.done(8);
            }
        };
