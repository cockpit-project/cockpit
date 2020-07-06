/* global cockpit */

// DOM objects
let state, command, run_button, output;

// systemd D-Bus API names
const O_SD_OBJ = "/org/freedesktop/systemd1";
const I_SD_MGR = "org.freedesktop.systemd1.Manager";
const I_SD_UNIT = "org.freedesktop.systemd1.Unit";
const I_DBUS_PROP = "org.freedesktop.DBus.Properties";

// default shell command for the long-running process to run
const default_command = "date; for i in `seq 30`; do echo $i; sleep 1; done";

// don't require superuser; this is only for reading the current state
const systemd_client = cockpit.dbus("org.freedesktop.systemd1");

function error(ex) {
    state.innerHTML = "Error: " + ex.toString();
    run_button.setAttribute("disabled", "");
}

// follow live output of the given unit, put into "output" <pre> area
function showJournal(unitName, filter_arg) {
    // run at most one instance of journal tailing
    if (this.journalctl)
        return;

    // reset previous output
    output.innerHTML = "";

    const argv = ["journalctl", "--output=cat", "--unit", unitName, "--follow", "--lines=all", filter_arg];
    this.journalctl = cockpit.spawn(argv, { superuser: "require", err: "message" })
            .stream(data => output.append(document.createTextNode(data)))
            .catch(ex => { output.innerHTML = JSON.stringify(ex) });
}

// check if the transient unit for our command is running
function checkState(unit) {
    systemd_client.call(O_SD_OBJ, I_SD_MGR, "GetUnit", [unit], { type: "s" })
            .then(([unitObj]) => {
                /* Some time may pass between getting JobNew and the unit actually getting activated;
                 * we may get an inactive unit here; watch for state changes. This will also update
                 * the UI if the unit stops. */
                this.subscription = systemd_client.subscribe(
                    { interface: I_DBUS_PROP, member: "PropertiesChanged" },
                    (path, iface, signal, args) => {
                        if (path === unitObj && args[1].ActiveState)
                            checkState(unit);
                    });

                systemd_client.call(unitObj, I_DBUS_PROP, "GetAll", [I_SD_UNIT], { type: "s" })
                        .then(([props]) => {
                            if (props.ActiveState.v === 'activating') {
                                state.innerHTML = cockpit.format("$0 is running", unit);
                                run_button.setAttribute("disabled", "");
                                // StateChangeTimestamp property is in µs since epoch, but journalctl expects seconds
                                showJournal(unit, "--since=@" + Math.floor(props.StateChangeTimestamp.v / 1000000));
                            } else if (props.ActiveState.v === 'failed') {
                                state.innerHTML = cockpit.format("$0 is not running and failed", unit);
                                run_button.setAttribute("disabled", "");
                                // Show the whole journal of this boot; this may be refined a bit with props.InvocationID
                                showJournal(unit, "--boot");
                            } else {
                                /* Type=oneshot transient units only have state "activating" or "failed",
                                 * or don't exist at all (handled below in NoSuchUnit case).
                                 * If you don't care about "failed", call systemd-run with --collect */
                                state.innerHTML = cockpit.format("Error: unexpected state of $0: $1", unit, props.ActiveState.v);
                            }
                        })
                        .catch(error);
            })
            .catch(ex => {
                if (ex.name === "org.freedesktop.systemd1.NoSuchUnit") {
                    if (this.subscription) {
                        this.subscription.remove();
                        this.subscription = null;
                    }
                    state.innerHTML = cockpit.format("$0 is not running", unit);
                    run_button.removeAttribute("disabled");
                } else {
                    error(ex);
                }
            });
}

/* Start long-running process, called on clicking the "Start Process" button.
 * This runs as root, thus will be shared with all privileged Cockpit sessions.
 */
function run(unit) {
    const argv = ["systemd-run", "--unit", unit, "--service-type=oneshot", "--no-block", "--", "/bin/sh", "-ec", command.value];
    cockpit.spawn(argv, { superuser: "require", err: "message" })
            .catch(error);
}

// called once after page initializes
function setup() {
    state = document.getElementById("state");
    command = document.getElementById("command");
    run_button = document.getElementById("run");
    output = document.getElementById("output");

    state.innerHTML = "initializing";
    command.value = default_command;

    /* Build a service name which contains exactly the identifying properties for the
     * command to re-attach to. For a single static command this is just the page name,
     * but it could also include the command name or path, arguments, or a playbook name,
     * etc.  if the page is dealing with multiple commands. */
    const serviceName = "cockpit-longrunning.service";

    run_button.addEventListener("click", () => run(serviceName));

    // Watch for start event of the service
    systemd_client.subscribe({ interface: I_SD_MGR, member: "JobNew" }, (path, iface, signal, args) => {
        if (args[2] == serviceName)
            checkState(serviceName);
    });
    // Check if it is already running
    checkState(serviceName);
}

// Wait until page is loaded
cockpit.transport.wait(setup);
