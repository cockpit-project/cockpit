/* global ph_mouse ph_set_result ph_wait_present */

async function test() {
    try {
        await ph_wait_present("#server-field");
        document.getElementById("server-field").value = "localhost";
        // this will cause a page load, ending the test
        ph_mouse("#login-button", "click");
    } catch (e) {
        ph_set_result(e);
    }
}

test();
