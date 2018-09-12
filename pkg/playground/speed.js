(function() {
    var cockpit = require("cockpit");

    var channel = null;
    var websocket = null;
    var timer = null;
    var start = null;
    var total = 0;
    var proc = null;

    function update() {
        var element = document.getElementById("speed");
        if (channel || websocket) {
            element.innerHTML = cockpit.format_bytes_per_sec((total * 1000) / (Date.now() - start));
            console.log(total);
        } else {
            element.innerHTML = "";
        }

        var memory = document.getElementById("memory");
        var pid = document.getElementById("pid");
        if (!proc) {
            proc = cockpit.script("echo $PPID && cat /proc/$PPID/statm");
            proc.then(function(data) {
                var parts = data.split("\n");
                pid.innerHTML = parts[0];
                memory.innerHTML = parts[1];
                proc = null;
            }, function(ex) {
                memory.innerHTML = String(ex);
                proc = null;
            });
        }
    }

    function echo(ev) {
        stop();

        var sideband = ev.target.id == "echo-sideband";

        function generate(length, binary) {
            if (binary)
                return new window.ArrayBuffer(length);
            else
                return (new Array(length)).join("x");
        }

        var length = parseInt(document.getElementById("message").value, 10);
        var batch = parseInt(document.getElementById("batch").value, 10);
        var interval = parseInt(document.getElementById("interval").value, 10);

        if (isNaN(length) || isNaN(interval) || isNaN(batch)) {
            window.alert("Bad value");
            return;
        }

        var binary = document.getElementById.checked;
        var options = { payload: "echo" };
        var input = generate(length, binary);
        start = new Date();
        total = 0;

        if (sideband) {
            if (binary)
                options.binary = "raw";

            websocket = new window.WebSocket(cockpit.transport.uri("channel/" + cockpit.transport.csrf_token) +
                "?" + window.btoa(JSON.stringify(options)));
            websocket.binaryType = 'arraybuffer';

            websocket.onopen = function() {
                for (var i = 0; i < batch; i++)
                    websocket.send(input);
                timer = window.setInterval(function() {
                    for (var i = 0; i < batch; i++)
                        websocket.send(input);
                }, interval);
            };

            websocket.onmessage = function(event) {
                if (binary)
                    total += event.data.byteLength;
                else
                    total += event.data.length;
            };

            websocket.onclose = function(event) {
                if (websocket)
                    window.alert("channel closed");
                stop();
            };

        } else {

            if (binary)
                options.binary = true;

            channel = cockpit.channel(options);

            channel.addEventListener("message", function(event, data) {
                total += data.length;
            });
            channel.addEventListener("close", function(event, options) {
                if (options.problem)
                    window.alert(options.problem);
                stop();
            });

            for (var i = 0; i < batch; i++)
                channel.send(input);

            timer = window.setInterval(function() {
                for (var i = 0; i < batch; i++)
                    channel.send(input);
            }, interval);
        }
    }

    function read(ev) {
        stop();

        var sideband = ev.target.id == "read-sideband";
        var path = document.getElementById("read-path");

        var options = {
            payload: "fsread1",
            path: path.value,
            max_read_size: 100 * 1024 * 1024 * 1024,
            binary: sideband ? "raw" : true,
        };

        start = Date.now();
        total = 0;

        if (sideband) {
            websocket = new window.WebSocket(cockpit.transport.uri("channel/" + cockpit.transport.csrf_token) +
                "?" + window.btoa(JSON.stringify(options)));
            websocket.binaryType = 'arraybuffer';
            websocket.onmessage = function(event) {
                total += event.data.byteLength;
            };
            websocket.onclose = function(event) {
                if (websocket)
                    window.alert("channel closed");
                stop();
            };
        } else {
            channel = cockpit.channel(options);
            channel.addEventListener("message", function(event, data) {
                total += data.length;
            });
            channel.addEventListener("close", function(event, options) {
                if (options.problem)
                    window.alert(options.problem);
                stop();
            });
        }
    }

    function download(ev) {
        stop();

        var path = document.getElementById("download-path");
        var anchor;

        var options = {
            binary: "raw",
            max_read_size: 100 * 1024 * 1024 * 1024,
            external: {
                "content-disposition": 'attachment; filename="download"',
                "content-type": "application/octet-stream"
            }
        };

        /* Allow use of HTTP URLs */
        if (path.value.indexOf("http") === 0) {
            anchor = document.createElement("a");
            anchor.href = path.value;
            options["payload"] = "http-stream2";
            options["address"] = anchor.hostname;
            options["port"] = parseInt(anchor.port, 10);
            options["path"] = anchor.pathname;
            options["method"] = "GET";
        } else {
            options["payload"] = "fsread1";
            options["path"] = path.value;
        }

        console.log("Download", options);

        start = Date.now();
        total = 0;

        var query = window.btoa(JSON.stringify(options));
        window.open("/cockpit/channel/" + cockpit.transport.csrf_token + "?" + query);
    }

    function stop() {
        update();

        if (channel)
            channel.close();
        channel = null;
        var ws = websocket;
        websocket = null;
        if (ws)
            ws.close();

        window.clearInterval(timer);
        timer = null;
    }

    cockpit.transport.wait(function() {
        document.getElementById("echo-normal").addEventListener("click", echo);
        document.getElementById("echo-sideband").addEventListener("click", echo);
        document.getElementById("read-normal").addEventListener("click", read);
        document.getElementById("read-sideband").addEventListener("click", read);
        document.getElementById("download-external").addEventListener("click", download);
        document.getElementById("stop").addEventListener("click", stop);
        window.setInterval(update, 500);
        document.body.style.display = "block";
    });
}());
