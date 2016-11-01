/* global cockpit, test */

        /* This is *NOT* a development guide, we take lots of shortcuts here */

        var parent_tests = 1;
        var frame_tests = 6;

        /* Top level window */
        function parent_window() {
            document.getElementById("title").innerHTML = "Cockpit Parent Frame";
            window.name = "cockpit1";
            var initialized = false;
            var frame;

            cockpit.transport.filter(function(message, channel, control) {
                if (initialized)
                    frame.postMessage(message, cockpit.transport.origin);
            });

            window.addEventListener("message", function(event) {
                var message = event.data;
                if (message.length === 0) {
                    test.done(parent_tests + frame_tests);
                } else if (message.indexOf('"init"') !== -1) {
                    initialized = true;
                    frame.postMessage('\n{ "command": "init", "version": 1, \
                                           "a": "b", "host" : "frame_host"  }',
                                      cockpit.transport.origin);
                } else {
                    var ret = cockpit.transport.inject(message);
                    if (!ret) console.error("inject failed");
                }
            }, false);

            /* This keeps coming up in tests ... how to open the transport */
            var chan = cockpit.channel({ "payload": "resource2" });
            chan.addEventListener("close", function() {
                 test.equal(cockpit.transport.host, "localhost",
                            "parent cockpit.transport.host");
                 var iframe = document.createElement("iframe");
                 iframe.setAttribute("name", "cockpit1:blah");
                 iframe.setAttribute("src", window.location.href + "?sub");
                 document.body.appendChild(iframe);
                 frame = window.frames["cockpit1:blah"];
            });
        }

        function child_frame() {
            var spawn_done = false;
            var binary_done = false;

            test.start_from(parent_tests);

            document.getElementById("title").innerHTML = "Cockpit Child Frame";
            cockpit.spawn(["/bin/sh", "-c", "echo hi"],
                          { "host" : "localhost"}).
                done(function(resp) {
                    test.assert(resp == "hi\n", "framed channel got output");
                }).
                always(function() {
                    test.assert(this.state() == "resolved", "framed channel closed");
                    test.equal(cockpit.transport.host, "frame_host",
                               "framed cockpit.transport.host");
                    spawn_done = true;
                    if (spawn_done && binary_done) {
                        test.done();
                        cockpit.transport.close();
                    }
                });

            var channel = cockpit.channel({ "payload": "echo", "binary": true,
                                            "host" : "localhost"});
            channel.addEventListener("message", function(ev, payload) {
                test.assert(typeof payload[0] == "number", "binary channel got a byte array");

                var match = true;
                for (var i = 0; i < payload.length; i++) {
                    if (payload[i] !== i)
                        match = false;
                }
                test.assert(match === true, "binary channel got back right data");
                channel.close();
            });
            channel.addEventListener("close", function(ev, options) {
                test.assert(!options.reason, "binary channel close cleanly");
                binary_done = true;
                if (spawn_done && binary_done) {
                    test.done();
                    cockpit.transport.close();
                }
            });

            var view = new Array(8);
            for (var i = 0; i < 8; i++)
                view[i] = i;
            channel.send(view);
        }

        if (window.parent === window)
            parent_window();
        else
            child_frame();
