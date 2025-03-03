Until there is a more concise explanation here about the threat model (what it
defends against) and assurance case (why it is secure), one should be able to
get the necessary informaion from this blog post:
https://cockpit-project.org/blog/is-cockpit-secure.html

The post is not exactly clear on this, but there could be a security boundary
between cockpit-ws running on one host and another host where cockpit-bridge is
spawned via ssh, where if the second host was infected with malware it should
be prevented from harming the first.
