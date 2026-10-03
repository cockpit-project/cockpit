/* global cockpit ph_set_result ph_wait_present */

async function test() {
    try {
        // ends with page load
        ph_wait_present("#shell-page");
        cockpit.logout();
        ph_set_result("PASS");
    } catch (e) {
        ph_set_result(e);
    }
}

test();
