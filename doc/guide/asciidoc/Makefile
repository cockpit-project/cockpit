all: render_html render_man

render_html:
	mkdir -p output/html
	asciidoctor -b html5 -D output/html cockpit-guide.adoc

render_man:
	mkdir -p output/html
	asciidoctor -b manpage -D output/man ./man/*.adoc

clean:
	rm -rf output/
