async function test() {
    try {
        await ph_wait_present("#server-field");
        await ph_wait_present("#recent-hosts");
        // this will cause a page load, ending the test
        ph_mouse(".host-name", "click");
    } catch(e) {
        ph_set_result(e);
    }
}

test();

// WebKit.run_javascript() needs some serializable return value
true
