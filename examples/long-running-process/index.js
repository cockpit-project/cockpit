/* global cockpit */

import { LongRunningProcess, ProcessState } from './long-running-process.js';

// DOM objects
let state, command, run_button, output;

// default shell command for the long-running process to run
const default_command = "date; for i in `seq 30`; do echo $i; sleep 1; done";

// follow live output of the given unit, put into "output" <pre> area
function showJournal(unitName, filter_arg) {
    // run at most one instance of journal tailing
    if (showJournal.journalctl)
        return;

    // reset previous output
    output.textContent = "";

    const argv = ["journalctl", "--output=cat", "--unit", unitName, "--follow", "--lines=all", filter_arg];
    showJournal.journalctl = cockpit.spawn(argv, { superuser: "require", err: "message" })
            .stream(data => output.append(document.createTextNode(data)))
            .catch(ex => { output.textContent = JSON.stringify(ex) });
}

function update(process) {
    state.textContent = cockpit.format("$0 $1", process.serviceName, process.state);

    switch (process.state) {
    case ProcessState.INIT:
        break;
    case ProcessState.STOPPED:
        run_button.removeAttribute("disabled");
        run_button.textContent = "Start";
        break;
    case ProcessState.RUNNING:
        run_button.removeAttribute("disabled");
        run_button.textContent = "Terminate";
        // StateChangeTimestamp property is in µs since epoch, but journalctl expects seconds
        showJournal(process.serviceName, "--since=@" + Math.floor(process.startTimestamp / 1000000));
        break;
    case ProcessState.FAILED:
        run_button.setAttribute("disabled", "");
        run_button.textContent = "Start";
        // Show the whole journal of this boot
        showJournal(process.serviceName, "--boot");
        break;
    default:
        throw new Error("unexpected process.state: " + process.state);
    }
}

// called once after page initializes; set up the page
cockpit.transport.wait(() => {
    state = document.getElementById("state");
    command = document.getElementById("command");
    run_button = document.getElementById("run");
    output = document.getElementById("output");

    command.value = default_command;

    /* Build a service name which contains exactly the identifying properties for the
     * command to re-attach to. For a single static command this is just the page name,
     * but it could also include the command name or path, arguments, or a playbook name,
     * etc.  if the page is dealing with multiple commands. */
    const serviceName = "cockpit-longrunning.service";

    // Set up process manager; update() is called whenever the running state changes
    const process = new LongRunningProcess(serviceName, update);

    /* Start process on clicking the "Start" button
     * This runs as root, thus will be shared with all privileged Cockpit sessions.
     */
    run_button.addEventListener("click", () => {
        if (process.state === ProcessState.RUNNING)
            process.terminate();
        else
            process.run(["/bin/sh", "-ec", command.value])
                    .catch(ex => {
                        state.textContent = "Error: " + ex.toString();
                        run_button.setAttribute("disabled", "");
                    });
    });
});
