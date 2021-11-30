async function test() {
    try {
        await ph_wait_present("#server-field");
        document.getElementById("server-field").value = "localhost";
        // this will cause a page load, ending the test
        ph_mouse("#login-button", "click");
    } catch(e) {
        ph_set_result(e);
    }
}

test();

// WebKit.run_javascript() needs some serializable return value
true
