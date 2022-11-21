/* global ph_mouse ph_set_result ph_wait_not_visible ph_wait_present */

async function test() {
    try {
        await ph_wait_present("#server-field");
        await ph_wait_present("#recent-hosts");
        await ph_wait_present(".host-line");

        ph_mouse(".host-remove", "click");
        await ph_wait_not_visible("#recent-hosts");

        ph_set_result("PASS");
    } catch (e) {
        ph_set_result(e);
    }
}

test();
