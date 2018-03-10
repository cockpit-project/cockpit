var address = document.getElementById("address");
var output = document.getElementById("output");
var result = document.getElementById("result");

document.querySelector(".container-fluid").style["max-width"] = "500px";
document.getElementById("ping").addEventListener("click", ping_run);

function ping_run() {
    var proc = cockpit.spawn(["ping", "-c", "4", address.value]);
    proc.done(ping_success);
    proc.stream(ping_output);
    proc.fail(ping_fail);

    result.innerHTML = "";
    output.innerHTML = "";
}

function ping_success() {
    result.style.color = "green";
    result.innerHTML = "success";
}

function ping_fail() {
    result.style.color = "red";
    result.innerHTML = "fail";
}

function ping_output(data) {
    output.append(document.createTextNode(data));
}

// Send a 'init' message.  This tells the tests that we are ready to go
cockpit.transport.wait(function() { });
