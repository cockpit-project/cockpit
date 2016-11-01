/* global cockpit, test */

    var parent_tests = 6;
    var frame_tests = 6;

    /* Top level window */
    function parent_window() {
        document.getElementById("title").innerHTML = "Cockpit Parent Frame";
        var count = 0;
        var frame;
        var cache;
        var child_done = false;

        function maybe_done () {
            if (child_done && count == 2)
                test.done(frame_tests + parent_tests);
        }

        window.addEventListener("message", function(event) {
            if (event.data == "child-done") {
                child_done = true;
                maybe_done();
            }
        });

        function provider(result, key) {
            test.equal(key, "cross-frame-cache", "parent provider got right key");
            test.equal(typeof result, "function", "parent provider got result function");

            var timer = window.setTimeout(function() {
                result({ myobject: "value" });
                window.clearTimeout(timer);
            }, 200);
            return {
                close: function() {}
            };
        }

        function consumer(value, key) {
            count++;
            test.equal(key, "cross-frame-cache", "parent consumer got right key");
            if (count === 1) {
                test.equal(value.myobject, "value", "parent consumer got parent value");
            } else {
                test.equal(value.myobject, "value2", "parent consumer got child value");
            }
        }

        cache = cockpit.cache("cross-frame-cache", provider, consumer, 'parent');
        var iframe = document.createElement("iframe");
        iframe.setAttribute("name", "cockpit1:blah");
        iframe.setAttribute("src", window.location.href + "?sub");
        document.body.appendChild(iframe);
        frame = window.frames["blah"];
    }

    function child_frame() {
        document.getElementById("title").innerHTML = "Cockpit Child Frame";
        var count = 0;
        var cache;

        test.start_from(parent_tests);

        function provider(result, key) {
            test.equal(key, "cross-frame-cache", "child provider got right key");
            test.equal(typeof result, "function", "child provider got result function");
            var timer = window.setTimeout(function() {
                result({ myobject: "value2" });
                window.clearTimeout(timer);
            }, 200);
            return {
                close: function() {}
            };
        }

        function consumer(value, key) {
            count++;
            test.equal(key, "cross-frame-cache", "child consumer got right key");
            if (count === 1) {
                test.equal(value.myobject, "value", "child consumer got parent value");
                cache.claim();
            } else {
                test.equal(value.myobject, "value2", "child consumer got child value");
                window.parent.postMessage("child-done", "*");
                test.done();
            }
        }

        cache = cockpit.cache("cross-frame-cache", provider, consumer, 'child');
    }

    if (window.parent === window) {
        parent_window();
    } else {
        child_frame();
    }
