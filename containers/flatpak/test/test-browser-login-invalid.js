async function test() {
    try {
        await ph_wait_present("#server-field");
        document.getElementById("server-field").value = "unknown";
        ph_mouse(".host-name", "click");
    } catch(e) {
        ph_set_result(e);
    }
}

test();
