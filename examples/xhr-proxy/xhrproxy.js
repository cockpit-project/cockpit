/* This is an example how to monkey-patch XMLHttpRequest() for HTTP requests to a local service port.
 * Cockpit pages cannot use the standard XMLHttpRequest() due to its strict Content-Security-Policy,
 * so these need to be wrapped into a raw cockpit channel and be "really" done from the host where
 * the session runs. This is useful if you are wrapping existing JavaScript code that uses
 * XMLHttpRequest(), and you are unable to change that code to use cockpit.http().
 *
 * Note that non-localhost connections are still forbidden by this page's Content-Security-Policy
 * (which can be changed in the manifest), and browsers blocking Cross-Origin requests.
 *
 * Documentation links:
 * - https://cockpit-project.org/guide/latest/cockpit-channels.html
 * - doc/protocol.md
 * - doc/urls.md
 */

const origXHROpen = XMLHttpRequest.prototype.open;

/* The following is the reusable part which sets up the redirection. It must be called *after*
 * cockpit.transport.wait() finishes, so that cockpit.transport.csrf_token is initialized. */

function setupCockpitXHR() {
    XMLHttpRequest.prototype.open = function(method, url) {
        console.log(`calling patched XMLHttpRequest.open("${method}", "${url}")`);
        const u = new URL(url);
        if (u.protocol !== 'http:')
            throw new Error("This demo only supports http:// URLs");

        const channel = {
            payload: "http-stream2",
            method,
            address: u.hostname,
            port: u.port ? parseInt(u.port) : 80,
            path: u.pathname + u.hash,
        };

        const channel_url = "/cockpit/channel/" + cockpit.transport.csrf_token + "?" +
                            window.btoa(JSON.stringify(channel));

        origXHROpen.apply(this, ["GET", channel_url]);
    };
}

/* Send a 'init' message. After that we have the Cockpit transport token.
 * This also tells integration tests that we are ready to go. */
/* global cockpit */
cockpit.transport.wait(setupCockpitXHR);

/* The following implements the example page, and represents an application that uses
 * XMLHttpRequest() and is oblivious of running inside of Cockpit */

document.getElementById("get").addEventListener("click", () => {
    const url = document.getElementById("address").value;
    const xhr = new XMLHttpRequest();

    xhr.open("GET", url);
    xhr.onreadystatechange = () => {
        if (xhr.readyState === XMLHttpRequest.DONE) {
            console.log("XMLHttpRequest to", url, "done with status", xhr.status, "text", xhr.responseText);
            document.getElementById("result").textContent = xhr.status.toString();
            const output = document.getElementById("output");
            output.textContent = "";
            output.append(document.createTextNode(xhr.responseText));
        }
    };

    xhr.send();
});
