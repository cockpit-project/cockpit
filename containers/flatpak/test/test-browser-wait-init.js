async function test() {
    try {
        await ph_wait_present("#server-field");
        ph_set_result("found");
    } catch(e) {
        ph_set_result(e);
    }
}

test();

// WebKit.run_javascript() needs some serializable return value
true
