(function() {
    var $ = require("jquery");
    var cockpit = require("cockpit");

    function speed(bytes, start, suffix) {
        var done = Date.now();
        suffix = suffix || "";
        $("#speed").text(cockpit.format_bytes_per_sec((bytes * 1000) / (done - start)) + suffix);
    }

    function generate(length, binary) {
        if (binary)
            return new window.ArrayBuffer(length);
        else
            return (new Array(length)).join("x");
    }

    function normal() {
        $("#speed").empty();

        var length = parseInt($("#message").val(), 10);
        var batch = parseInt($("#batch").val(), 10);
        var interval = parseInt($("#interval").val(), 10);

        if (isNaN(length) || isNaN(interval) || isNaN(batch)) {
            window.alert("Bad value");
            return;
        }

        var binary = $("#binary").prop('checked');
        var options = { payload: "echo" };
        if (binary)
            options.binary = true;
        var channel = cockpit.channel(options);

        var total = 0;
        $(channel).on("message", function(event, data) {
            total += data.length;
        });

        $(channel).on("close", function(event, options) {
            if (options.problem)
                window.alert(options.problem);
        });

        var input = generate(length, binary);
        var start = Date.now();
        for (var i = 0; i < batch; i++)
            channel.send(input);

        var update = window.setInterval(function() {
            speed(total, start, "...");
        }, 500);

        var timer = window.setInterval(function() {
            for (var i = 0; i < batch; i++)
                channel.send(input);
        }, interval);

        window.setTimeout(function() {
            window.clearInterval(timer);
            window.clearInterval(update);
            channel.close();
            speed(total, start);
        }, 10000);
    }

    function sideband() {
        $("#speed").empty();

        var length = parseInt($("#message").val(), 10);
        var batch = parseInt($("#batch").val(), 10);
        var interval = parseInt($("#interval").val(), 10);

        if (isNaN(length) || isNaN(interval) || isNaN(batch)) {
            window.alert("Bad value");
            return;
        }

        var binary = $("#binary").prop('checked');
        var params = { payload: "echo" };
        if (binary)
            params.binary = "raw";

        var url = cockpit.transport.uri("channel/" + cockpit.transport.csrf_token);
        var ws = new window.WebSocket(url + "?" + window.btoa(JSON.stringify(params)));

        ws.binaryType = 'arraybuffer';

        var input = generate(length, binary);
        var done = false;
        var start;
        var total = 0;
        var timer;

        ws.onopen = function() {
            start = new Date();
            for (var i = 0; i < batch; i++)
                ws.send(input);
            timer = window.setInterval(function() {
                for (var i = 0; i < batch; i++)
                    ws.send(input);
            }, interval);
        };

        ws.onmessage = function(event) {
            if (binary)
                total += event.data.byteLength;
            else
                total += event.data.length;
        };

        var update = window.setInterval(function() {
            speed(total, start, "...");
        }, 500);

        ws.onclose = function(event) {
            if (!done)
                window.alert("channel closed");
        };

        window.setTimeout(function() {
            done = true;
            window.clearInterval(timer);
            window.clearInterval(update);
            ws.close();
            speed(total, start);
        }, 10000);
    }

    cockpit.transport.wait(function() {
        $("#normal").on("click", normal);
        $("#sideband").on("click", sideband);
        $("body").show();
    });
}());
