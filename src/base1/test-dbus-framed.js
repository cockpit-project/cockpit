/* global cockpit, test */

        /* This is *NOT* a development guide, we take lots of shortcuts here */

        var parent_tests = 1;
        var frame_tests = 2;

        /* Top level window */
        function parent_window() {
            document.getElementById("title").innerHTML = "Cockpit Parent Frame";
            window.name = "cockpit1";
            var initialized = false;
            var frame;

            cockpit.transport.filter(function(message, channel, control) {
                if (initialized) {
                    /* Inject an unknown message that gets sent
                     * before the reply
                     */
                    var pos = message.indexOf('\n');
                    if (pos > -1) {
                        var json = JSON.parse(message.substring(pos));
                        if (json.reply) {
                            frame.postMessage(message.substring(0, pos)+'\n{"unknown":"unknown"}',
                                              cockpit.transport.origin);
                        }
                    }
                    frame.postMessage(message, cockpit.transport.origin);
                }
            });

            window.addEventListener("message", function(event) {
                var message = event.data;
                if (message.length === 0) {
                    test.done(parent_tests + frame_tests);
                } else if (message.indexOf('"init"') !== -1) {
                    initialized = true;
                    frame.postMessage('\n{ "command": "init", "version": 1, \
                                           "a": "b", "host" : "localhost"  }',
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
            var dbus = cockpit.dbus("com.redhat.Cockpit.DBusTests.Test", { "bus": "session" });
            dbus.call("/otree/frobber", "com.redhat.Cockpit.DBusTests.Frobber",
                      "HelloWorld", [ "Browser-side JS" ]).
                done(function(reply) {
                    test.equal(reply[0], "Word! You said `Browser-side JS'. I'm Skeleton, btw!", "reply");
                    dbus.close();
                }).
                always(function() {
                    test.equal(this.state(), "resolved", "finished successfuly");
                });
            dbus.addEventListener("close", function(ev, options) {
                test.assert(!options.problem, "close cleanly");
                test.done();
                cockpit.transport.close();
            });
        }

        if (window.parent === window)
            parent_window();
        else
            child_frame();
