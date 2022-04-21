/* global ph_set_result ph_wait_present */

async function test() {
    try {
        await ph_wait_present("#server-field");
        ph_set_result("found");
    } catch (e) {
        ph_set_result(e);
    }
}

test();
