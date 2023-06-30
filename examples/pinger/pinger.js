const address = document.getElementById("address");
const output = document.getElementById("output");
const result = document.getElementById("result");
const button = document.getElementById("ping");

function ping_run() {
    /* global cockpit */
    cockpit.spawn(["ping", "-c", "4", address.value])
            .stream(ping_output)
            .then(ping_success)
            .catch(ping_fail);

    result.textContent = "";
    output.textContent = "";
}

function ping_success() {
    result.style.color = "green";
    result.textContent = "success";
}

function ping_fail() {
    result.style.color = "red";
    result.textContent = "fail";
}

function ping_output(data) {
    output.append(document.createTextNode(data));
}

// Connect the button to starting the "ping" process
button.addEventListener("click", ping_run);

// Send a 'init' message.  This tells integration tests that we are ready to go
cockpit.transport.wait(function() { });
