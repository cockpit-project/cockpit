/* global cockpit ph_set_result */

async function test() {
    try {
        // ends with page load
        cockpit.logout();
        ph_set_result("PASS");
    } catch (e) {
        ph_set_result(e);
    }
}

test();
