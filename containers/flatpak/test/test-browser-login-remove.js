async function test() {
    try {
        await ph_wait_present("#server-field");
        await ph_wait_present("#recent-hosts");
        await ph_wait_present(".host-line", 1);

        ph_mouse(".host-remove", "click");
        await ph_wait_not_visible("#recent-hosts");

        ph_set_result("PASS");
    } catch(e) {
        ph_set_result(e);
    }
}

test();
